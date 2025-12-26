import { CODEX_BASE_URL } from "@/auth/codex-oauth/constants"

const USER_AGENT = "arctic-cli"

export type CodexUsagePayload = {
  plan_type: string
  rate_limit?: CodexRateLimitStatusDetails | null
  credits?: CodexCreditsDetails | null
}

export type CodexRateLimitStatusDetails = {
  allowed: boolean
  limit_reached: boolean
  primary_window?: CodexRateLimitWindowSnapshot | null
  secondary_window?: CodexRateLimitWindowSnapshot | null
}

export type CodexRateLimitWindowSnapshot = {
  used_percent: number
  limit_window_seconds: number
  reset_after_seconds: number
  reset_at: number
}

export type CodexCreditsDetails = {
  has_credits: boolean
  unlimited: boolean
  balance?: string | null
}

/**
 * Normalizes a ChatGPT/Codex base URL so we can derive the correct usage path.
 * - Trims whitespace and trailing slashes.
 * - Ensures chatgpt.com/.openai.com hosts include /backend-api for WHAM endpoints.
 */
export function normalizeCodexBaseUrl(input?: string | null): string {
  let normalized =
    typeof input === "string" && input.trim().length > 0 ? input.trim() : CODEX_BASE_URL
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }
  if (
    (normalized.startsWith("https://chatgpt.com") || normalized.startsWith("https://chat.openai.com")) &&
    !normalized.includes("/backend-api")
  ) {
    normalized = `${normalized}/backend-api`
  }
  return normalized
}

/**
 * Builds the fully qualified URL for the usage endpoint, matching the Codex CLI logic:
 * - /wham/usage for ChatGPT backend hosts.
 * - /api/codex/usage for codex backend hosts.
 */
export function buildCodexUsageUrl(baseUrl?: string | null): string {
  const normalized = normalizeCodexBaseUrl(baseUrl)
  const path = normalized.includes("/backend-api") ? "/wham/usage" : "/api/codex/usage"
  return `${normalized}${path}`
}

/**
 * Fetches the account usage payload from the Codex backend.
 */
export async function fetchCodexUsagePayload(options: {
  baseUrl?: string | null
  accessToken: string
  accountId: string
}): Promise<CodexUsagePayload> {
  const url = buildCodexUsageUrl(options.baseUrl)
  const headers = new Headers({
    Authorization: `Bearer ${options.accessToken}`,
    "ChatGPT-Account-Id": options.accountId,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  })

  const response = await fetch(url, { method: "GET", headers })
  const bodyText = await response.text()
  if (!response.ok) {
    const status = typeof response.status === "number" ? response.status : "unknown"
    throw new Error(
      `Codex usage request failed (${status}): ${bodyText || "Unexpected response"}`,
    )
  }

  if (!bodyText) {
    throw new Error("Codex usage response was empty.")
  }

  let payload: CodexUsagePayload
  try {
    payload = JSON.parse(bodyText) as CodexUsagePayload
  } catch {
    throw new Error("Codex usage response was not valid JSON.")
  }

  if (typeof payload.plan_type !== "string" || payload.plan_type.length === 0) {
    payload.plan_type = "unknown"
  }

  return payload
}
