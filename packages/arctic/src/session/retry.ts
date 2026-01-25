import type { NamedError } from "@arctic-cli/util/error"
import { MessageV2 } from "./message-v2"

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds

  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms)
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout)
          reject(new DOMException("Aborted", "AbortError"))
        },
        { once: true },
      )
    })
  }

  // extract retry delay from google error messages like "quota will reset after 46s"
  function extractGoogleRetryDelay(message: string): number | undefined {
    const match = message.match(/reset after (\d+)s/i)
    if (match) {
      const seconds = Number.parseInt(match[1], 10)
      if (!Number.isNaN(seconds) && seconds > 0) {
        return seconds * 1000
      }
    }
    return undefined
  }

  // extract retry delay from response body for google/gemini errors
  function extractRetryDelayFromBody(responseBody: string | undefined): number | undefined {
    if (!responseBody) return undefined
    try {
      const body = JSON.parse(responseBody)
      // handle google error format: { error: { message: "...reset after Xs..." } }
      // or array format: [{ error: { message: "..." } }]
      const errorObj = Array.isArray(body) ? body[0]?.error : body?.error
      if (errorObj?.message) {
        return extractGoogleRetryDelay(errorObj.message)
      }
    } catch {}
    return undefined
  }

  export function delay(attempt: number, error?: MessageV2.APIError) {
    if (error) {
      const headers = error.data.responseHeaders
      if (headers) {
        const retryAfterMs = headers["retry-after-ms"]
        if (retryAfterMs) {
          const parsedMs = Number.parseFloat(retryAfterMs)
          if (!Number.isNaN(parsedMs)) {
            return parsedMs
          }
        }

        const retryAfter = headers["retry-after"]
        if (retryAfter) {
          const parsedSeconds = Number.parseFloat(retryAfter)
          if (!Number.isNaN(parsedSeconds)) {
            // convert seconds to milliseconds
            return Math.ceil(parsedSeconds * 1000)
          }
          // Try parsing as HTTP date format
          const parsed = Date.parse(retryAfter) - Date.now()
          if (!Number.isNaN(parsed) && parsed > 0) {
            return Math.ceil(parsed)
          }
        }
      }

      // try to extract delay from google error message/body
      const fromMessage = extractGoogleRetryDelay(error.data.message)
      if (fromMessage) return fromMessage

      const fromBody = extractRetryDelayFromBody(error.data.responseBody)
      if (fromBody) return fromBody

      if (headers) {
        return RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
      }
    }

    return Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS)
  }

  // check if error is a rate limit error (429 or RESOURCE_EXHAUSTED)
  function isRateLimitError(error: MessageV2.APIError): boolean {
    // check status code
    if (error.data.statusCode === 429) return true

    // check message for common rate limit patterns
    const message = error.data.message.toLowerCase()
    if (message.includes("rate limit") || message.includes("too many requests")) return true
    if (message.includes("resource_exhausted") || message.includes("quota")) return true

    // check response body for google-specific errors
    if (error.data.responseBody) {
      try {
        const body = JSON.parse(error.data.responseBody)
        const errorObj = Array.isArray(body) ? body[0]?.error : body?.error
        if (errorObj?.status === "RESOURCE_EXHAUSTED") return true
        if (errorObj?.code === 429) return true
        if (errorObj?.details?.some((d: any) => d.reason === "RATE_LIMIT_EXCEEDED")) return true
      } catch {}
    }

    return false
  }

  export function retryable(error: ReturnType<NamedError["toObject"]>) {
    if (MessageV2.APIError.isInstance(error)) {
      // always retry rate limit errors even if isRetryable is false
      if (isRateLimitError(error)) {
        if (error.data.message.includes("quota")) return "Rate limit exceeded, waiting for quota reset"
        return "Rate limit exceeded"
      }
      if (!error.data.isRetryable) return undefined
      return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
    }

    if (typeof error.data?.message === "string") {
      try {
        const json = JSON.parse(error.data.message)
        if (json.type === "error" && json.error?.type === "too_many_requests") {
          return "Too Many Requests"
        }
        if (json.code === "Some resource has been exhausted") {
          return "Provider is overloaded"
        }
      } catch {}
    }

    return undefined
  }
}
