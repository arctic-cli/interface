export const GITHUB_API_BASE_URL = "https://api.github.com"

const USER_AGENT = "arctic-cli"

export type GitHubUser = {
  id: number
  login: string
  name?: string
  email?: string
}

export async function fetchGithubUser(options: { token: string }): Promise<GitHubUser> {
  const url = `${GITHUB_API_BASE_URL}/user`
  const headers = new Headers({
    Authorization: `Bearer ${options.token}`,
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  })

  const response = await fetch(url, { method: "GET", headers })
  const bodyText = await response.text()

  if (!response.ok) {
    const status = typeof response.status === "number" ? response.status : "unknown"
    throw new Error(`GitHub user request failed (${status}): ${bodyText || "Unexpected response"}`)
  }

  if (!bodyText) {
    throw new Error("GitHub user response was empty.")
  }

  const payload = JSON.parse(bodyText) as GitHubUser
  return payload
}

export type QuotaSnapshot = {
  entitlement: number
  overage_count: number
  overage_permitted: boolean
  percent_remaining: number
  quota_id: string
  quota_remaining: number
  remaining: number
  unlimited: boolean
  timestamp_utc: string
  quota_breakdown?: string
  suggestions_count?: number
  quota_limit?: number
}

export type QuotaSnapshots = {
  chat?: QuotaSnapshot
  completions?: QuotaSnapshot
  premium_interactions?: QuotaSnapshot
  code_review?: QuotaSnapshot
  [key: string]: QuotaSnapshot | undefined
}

export type CopilotUsageResponse = {
  access_type_sku: string
  analytics_tracking_id: string
  assigned_date: string
  can_signup_for_limited: boolean
  chat_enabled: boolean
  copilot_plan: string
  organization_login_list: Array<unknown>
  organization_list: Array<unknown>
  quota_reset_date: string
  quota_snapshots: QuotaSnapshots
  quota_reset_date_utc: string
}

/**
 * Fetches GitHub Copilot usage from the GitHub API.
 */
export async function fetchGithubCopilotUsage(options: {
  token: string
}): Promise<CopilotUsageResponse> {
  const url = `${GITHUB_API_BASE_URL}/copilot_internal/user`
  const headers = new Headers({
    Authorization: `Bearer ${options.token}`,
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  })

  const response = await fetch(url, { method: "GET", headers })
  const bodyText = await response.text()

  if (!response.ok) {
    const status = typeof response.status === "number" ? response.status : "unknown"
    throw new Error(
      `GitHub Copilot usage request failed (${status}): ${bodyText || "Unexpected response"}`,
    )
  }

  if (!bodyText) {
    throw new Error("GitHub Copilot usage response was empty.")
  }

  let payload: CopilotUsageResponse
  try {
    payload = JSON.parse(bodyText) as CopilotUsageResponse
  } catch {
    throw new Error("GitHub Copilot usage response was not valid JSON.")
  }

  return payload
}
