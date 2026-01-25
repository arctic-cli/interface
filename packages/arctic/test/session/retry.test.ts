import { describe, expect, test } from "bun:test"
import { SessionRetry } from "../../src/session/retry"
import { MessageV2 } from "../../src/session/message-v2"

function apiError(
  opts: {
    headers?: Record<string, string>
    message?: string
    statusCode?: number
    isRetryable?: boolean
    responseBody?: string
  } = {},
): MessageV2.APIError {
  return new MessageV2.APIError({
    message: opts.message ?? "boom",
    isRetryable: opts.isRetryable ?? true,
    statusCode: opts.statusCode,
    responseHeaders: opts.headers,
    responseBody: opts.responseBody,
  }).toObject() as MessageV2.APIError
}

describe("session.retry.delay", () => {
  test("caps delay at 30 seconds when headers missing", () => {
    const error = apiError()
    const delays = Array.from({ length: 10 }, (_, index) => SessionRetry.delay(index + 1, error))
    expect(delays).toStrictEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000])
  })

  test("prefers retry-after-ms when shorter than exponential", () => {
    const error = apiError({ headers: { "retry-after-ms": "1500" } })
    expect(SessionRetry.delay(4, error)).toBe(1500)
  })

  test("uses retry-after seconds when reasonable", () => {
    const error = apiError({ headers: { "retry-after": "30" } })
    expect(SessionRetry.delay(3, error)).toBe(30000)
  })

  test("accepts http-date retry-after values", () => {
    const date = new Date(Date.now() + 20000).toUTCString()
    const error = apiError({ headers: { "retry-after": date } })
    const d = SessionRetry.delay(1, error)
    expect(d).toBeGreaterThanOrEqual(19000)
    expect(d).toBeLessThanOrEqual(20000)
  })

  test("ignores invalid retry hints", () => {
    const error = apiError({ headers: { "retry-after": "not-a-number" } })
    expect(SessionRetry.delay(1, error)).toBe(2000)
  })

  test("ignores malformed date retry hints", () => {
    const error = apiError({ headers: { "retry-after": "Invalid Date String" } })
    expect(SessionRetry.delay(1, error)).toBe(2000)
  })

  test("ignores past date retry hints", () => {
    const pastDate = new Date(Date.now() - 5000).toUTCString()
    const error = apiError({ headers: { "retry-after": pastDate } })
    expect(SessionRetry.delay(1, error)).toBe(2000)
  })

  test("uses retry-after values even when exceeding 10 minutes with headers", () => {
    const error = apiError({ headers: { "retry-after": "50" } })
    expect(SessionRetry.delay(1, error)).toBe(50000)

    const longError = apiError({ headers: { "retry-after-ms": "700000" } })
    expect(SessionRetry.delay(1, longError)).toBe(700000)
  })

  test("extracts delay from google error message", () => {
    const error = apiError({
      message: "Too Many Requests: Your quota will reset after 46s.",
    })
    expect(SessionRetry.delay(1, error)).toBe(46000)
  })

  test("extracts delay from google response body", () => {
    const error = apiError({
      message: "Too Many Requests",
      responseBody: JSON.stringify({
        error: {
          code: 429,
          message: "You have exhausted your capacity on this model. Your quota will reset after 30s.",
          status: "RESOURCE_EXHAUSTED",
        },
      }),
    })
    expect(SessionRetry.delay(1, error)).toBe(30000)
  })

  test("extracts delay from google array response body", () => {
    const error = apiError({
      message: "Too Many Requests",
      responseBody: JSON.stringify([
        {
          error: {
            code: 429,
            message: "You have exhausted your capacity on this model. Your quota will reset after 60s.",
            status: "RESOURCE_EXHAUSTED",
          },
        },
      ]),
    })
    expect(SessionRetry.delay(1, error)).toBe(60000)
  })
})

describe("session.retry.retryable", () => {
  test("returns undefined for non-retryable errors", () => {
    const error = apiError({ isRetryable: false, message: "Bad Request" })
    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  test("returns message for retryable errors", () => {
    const error = apiError({ isRetryable: true, message: "Server Error" })
    expect(SessionRetry.retryable(error)).toBe("Server Error")
  })

  test("returns special message for overloaded errors", () => {
    const error = apiError({ isRetryable: true, message: "Provider is Overloaded" })
    expect(SessionRetry.retryable(error)).toBe("Provider is overloaded")
  })

  test("retries 429 status code even when isRetryable is false", () => {
    const error = apiError({
      isRetryable: false,
      statusCode: 429,
      message: "Too Many Requests",
    })
    expect(SessionRetry.retryable(error)).toBe("Rate limit exceeded")
  })

  test("retries google RESOURCE_EXHAUSTED errors", () => {
    const error = apiError({
      isRetryable: false,
      statusCode: 429,
      message: "Too Many Requests: quota exceeded",
      responseBody: JSON.stringify({
        error: {
          code: 429,
          message: "You have exhausted your capacity on this model.",
          status: "RESOURCE_EXHAUSTED",
        },
      }),
    })
    expect(SessionRetry.retryable(error)).toBe("Rate limit exceeded, waiting for quota reset")
  })

  test("retries errors with quota in message", () => {
    const error = apiError({
      isRetryable: false,
      message: "Your quota has been exceeded",
    })
    expect(SessionRetry.retryable(error)).toBe("Rate limit exceeded, waiting for quota reset")
  })

  test("retries errors with rate limit in message", () => {
    const error = apiError({
      isRetryable: false,
      message: "rate limit exceeded",
    })
    expect(SessionRetry.retryable(error)).toBe("Rate limit exceeded")
  })

  test("retries RATE_LIMIT_EXCEEDED in response details", () => {
    const error = apiError({
      isRetryable: false,
      message: "Error",
      responseBody: JSON.stringify({
        error: {
          code: 429,
          details: [{ reason: "RATE_LIMIT_EXCEEDED" }],
        },
      }),
    })
    expect(SessionRetry.retryable(error)).toBe("Rate limit exceeded")
  })
})
