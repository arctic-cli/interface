import { Auth } from "@/auth"
import { CodexClient } from "@/auth/codex"
import { decodeJWT, refreshAccessToken } from "@/auth/codex-oauth/auth/auth"
import { JWT_CLAIM_PATH } from "@/auth/codex-oauth/constants"
import { refreshAccessToken as refreshAnthropicToken } from "@/auth/anthropic-oauth"
import { OAuth2Client } from "google-auth-library"
import { Global } from "@/global"
import fs from "fs/promises"
import path from "path"
import { fetchCodexUsagePayload } from "@/provider/codex-backend"
import type { CodexCreditsDetails, CodexRateLimitWindowSnapshot } from "@/provider/codex-backend"
import { fetchGithubCopilotUsage, fetchGithubUser, type QuotaSnapshot } from "@/provider/github-copilot-backend"
import { fetchAntigravityModels, type AntigravityModelQuota } from "@/provider/antigravity-backend"
import { Provider } from "./provider"
import { Pricing } from "./pricing"
import z from "zod"
import { Storage } from "../storage/storage"
import { MessageV2 } from "../session/message-v2"

export namespace ProviderUsage {
  export type TimePeriod = "session" | "daily" | "weekly" | "monthly"

  export const RateLimitWindowSummary = z.object({
    usedPercent: z.number().nullable(),
    windowMinutes: z.number().nullable().optional(),
    resetsAt: z.number().nullable().optional(),
    label: z.string().optional(),
  })
  export type RateLimitWindowSummary = z.infer<typeof RateLimitWindowSummary>

  export const CreditsSummary = z.object({
    hasCredits: z.boolean(),
    unlimited: z.boolean(),
    balance: z.string().optional(),
  })
  export type CreditsSummary = z.infer<typeof CreditsSummary>

  export const TokenUsage = z.object({
    total: z.number().optional(),
    input: z.number().optional(),
    output: z.number().optional(),
    cached: z.number().optional(),
    cacheCreation: z.number().optional(),
  })
  export type TokenUsage = z.infer<typeof TokenUsage>

  export const CostSummary = z.object({
    totalCost: z.number().optional(),
    inputCost: z.number().optional(),
    outputCost: z.number().optional(),
    cacheCreationCost: z.number().optional(),
    cacheReadCost: z.number().optional(),
  })
  export type CostSummary = z.infer<typeof CostSummary>

  export const Record = z.object({
    providerID: z.string(),
    providerName: z.string(),
    planType: z.string().optional(),
    allowed: z.boolean().optional(),
    limitReached: z.boolean().optional(),
    limits: z
      .object({
        primary: RateLimitWindowSummary.optional(),
        secondary: RateLimitWindowSummary.optional(),
      })
      .optional(),
    credits: CreditsSummary.optional(),
    tokenUsage: TokenUsage.optional(),
    costSummary: CostSummary.optional(),
    fetchedAt: z.number(),
    error: z.string().optional(),
    accountId: z.string().optional(),
    accountUsername: z.string().optional(),
  })
  export type Record = z.infer<typeof Record>

  type UsageFetcher = (input: {
    provider: Provider.Info
    sessionID?: string
    timePeriod?: TimePeriod
  }) => Promise<Omit<Record, "providerID" | "providerName" | "fetchedAt">>

  const usageFetchers: { [key: string]: UsageFetcher } = {
    codex: fetchCodexUsage,
    "zai-coding-plan": fetchSessionUsage,
    "minimax-coding-plan": fetchMinimaxUsage,
    minimax: fetchMinimaxUsage,
    anthropic: fetchAnthropicUsage,
    "@ai-sdk/anthropic": fetchAnthropicUsage, // Alternative anthropic provider name
    openrouter: fetchSessionUsage, // Session-based tracking
    "@openrouter/ai-sdk-provider": fetchSessionUsage, // Alternative openrouter provider name
    "github-copilot": fetchGithubCopilotUsageWrapper,
    google: fetchGoogleUsage,
    "kimi-for-coding": fetchKimiUsage,
    antigravity: fetchAntigravityUsage,
    alibaba: fetchAlibabaUsage,
  }

  export async function fetch(
    targetProviders?: string | string[],
    options?: { sessionID?: string; timePeriod?: TimePeriod },
  ): Promise<Record[]> {
    const providers = await Provider.list()
    const normalizedTargets = normalizeTargetProviders(targetProviders)
    
    // when no targets specified, include all providers that have a usage fetcher
    // this includes provider connections (e.g. github-copilot:indo)
    const providerIDs = normalizedTargets && normalizedTargets.length > 0 
      ? normalizedTargets.filter((id) => id in providers)
      : Object.keys(providers).filter((id) => {
          const provider = providers[id]
          const baseProviderID = provider?.baseProvider ?? id
          return usageFetchers[id] || usageFetchers[baseProviderID]
        })

    const timestamp = Date.now()
    const results: Record[] = []

    for (const providerID of providerIDs) {
      const provider = providers[providerID]
      const baseProviderID = provider?.baseProvider ?? providerID
      const fetcher = usageFetchers[providerID] ?? usageFetchers[baseProviderID]
      const base: Record = {
        providerID,
        providerName: provider?.name ?? providerID,
        fetchedAt: timestamp,
      }

      const resolvedFetcher = fetcher ?? fetchSessionUsage

      try {
        const details = await resolvedFetcher({
          provider,
          sessionID: options?.sessionID,
          timePeriod: options?.timePeriod ?? "session",
        })
        results.push({
          ...base,
          ...details,
        })
      } catch (error) {
        results.push({
          ...base,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return results
  }

  function normalizeTargetProviders(input?: string | string[]): string[] | undefined {
    if (!input) return undefined
    if (Array.isArray(input)) {
      return input.filter((id) => typeof id === "string" && id.trim().length > 0)
    }
    return input
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  }

  async function fetchSessionUsage(input: {
    provider: Provider.Info
    sessionID?: string
    timePeriod?: TimePeriod
  }): Promise<Omit<Record, "providerID" | "providerName" | "fetchedAt">> {
    const timePeriod = input.timePeriod ?? "session"
    const now = Date.now()

    // Calculate time boundaries
    const timeFilter = getTimeFilter(timePeriod, now)

    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheCreationTokens = 0
    let found = false
    let inspectedMessages = 0
    let modelID: string | undefined
    let limitSummary:
      | {
          planType?: string
          allowed?: boolean
          limitReached?: boolean
          limits?: { primary?: RateLimitWindowSummary }
        }
      | undefined
    let limitError: string | undefined

    // For session mode, require sessionID
    if (timePeriod === "session" && !input.sessionID) {
      // We can still fetch usage limits for z.ai even without session context.
      if (input.provider.id !== "zai-coding-plan") {
        return {}
      }
    }

    // Get messages to scan (avoid scanning all sessions when sessionID is missing)
    let messageKeys: string[][] = []
    if (timePeriod === "session") {
      if (input.sessionID) {
        messageKeys = await Storage.list(["message", input.sessionID])
      }
    } else {
      // For time-based queries, scan all sessions
      const allSessions = await Storage.list(["message"])
      messageKeys = allSessions
    }

    for (const messageKey of messageKeys) {
      const msg = await Storage.read<MessageV2.Info>(messageKey)

      // Filter by provider - match exact provider ID (including connection)
      if (msg.role !== "assistant" || msg.providerID !== input.provider.id || !msg.tokens) {
        continue
      }

      // Filter by time period
      const messageTime = msg.time?.completed ?? msg.time?.created
      if (!messageTime || !timeFilter(messageTime)) {
        continue
      }

      found = true
      inspectedMessages++
      inputTokens += msg.tokens.input ?? 0
      outputTokens += msg.tokens.output ?? 0
      cacheReadTokens += msg.tokens.cache?.read ?? 0
      cacheCreationTokens += msg.tokens.cache?.write ?? 0

      // Track the model ID from the last message
      if (msg.modelID) {
        modelID = msg.modelID
      }
    }

    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens

    // Calculate costs if we have a model ID
    let costSummary: CostSummary | undefined
    if (modelID) {
      const costBreakdown = await Pricing.calculateCostAsync(modelID, {
        input: inputTokens,
        output: outputTokens,
        cacheCreation: cacheCreationTokens,
        cacheRead: cacheReadTokens,
      })

      if (costBreakdown) {
        costSummary = {
          totalCost: costBreakdown.totalCost,
          inputCost: costBreakdown.inputCost,
          outputCost: costBreakdown.outputCost,
          cacheCreationCost: costBreakdown.cacheCreationCost,
          cacheReadCost: costBreakdown.cacheReadCost,
        }
      }
    }

    if (input.provider.id === "zai-coding-plan") {
      try {
        limitSummary = await fetchZaiUsageLimits(input.provider)
      } catch (error) {
        limitError = error instanceof Error ? error.message : String(error)
      }
    }

    const record: Omit<Record, "providerID" | "providerName" | "fetchedAt"> = {}

    if (found) {
      record.tokenUsage = {
        total: totalTokens,
        input: inputTokens,
        output: outputTokens,
        cached: cacheReadTokens,
        cacheCreation: cacheCreationTokens,
      }
      record.costSummary = costSummary
    }

    if (limitSummary) {
      record.planType = limitSummary.planType
      record.allowed = limitSummary.allowed
      record.limitReached = limitSummary.limitReached
      record.limits = limitSummary.limits
    }

    if (limitError) {
      record.error = limitError
    }

    if (!found && !limitSummary && !limitError) {
      return {}
    }

    return record
  }

  const ZAI_USAGE_LIMITS_URL = "https://api.z.ai/api/monitor/usage/quota/limit"
  const ANTHROPIC_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
  const MINIMAX_USAGE_URL = "https://platform.minimax.io/v1/api/openplatform/coding_plan/remains"

  async function fetchZaiUsageLimits(provider: Provider.Info): Promise<{
    planType?: string
    allowed?: boolean
    limitReached?: boolean
    limits?: { primary?: RateLimitWindowSummary }
  }> {
    let token: string | undefined
    const auth = await Auth.get(provider.id)

    if (auth?.type === "api") {
      token = auth.key
    } else if (auth?.type === "oauth") {
      token = auth.access
    } else if (auth?.type === "wellknown") {
      token = auth.token || auth.key
    }

    if (!token) {
      token = provider.key ?? provider.options?.apiKey
    }

    if (!token) {
      throw new Error("Z.ai authentication is required. Set an API key for provider 'zai-coding-plan'.")
    }

    const response = await globalThis.fetch(ZAI_USAGE_LIMITS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Authorization failed. Please check your Z.ai API key.")
      }
      throw new Error(`Failed to fetch Z.ai usage limits: ${response.statusText}`)
    }

    const payload = (await response.json().catch(() => null)) as any
    const limits = Array.isArray(payload?.data?.limits) ? payload.data.limits : []
    if (!payload || payload.success !== true || limits.length === 0) {
      return {}
    }

    const rows = limits
      .map((limit: any, idx: number) => formatZaiLimitRow(limit, idx))
      .filter((row: string | undefined) => row && row.length > 0)

    const detailedPlan = rows.length > 0 ? `Z.ai\n${rows.map((row: string) => `- ${row}`).join("\n")}` : "Z.ai"

    const enriched = limits
      .map((limit: any) => ({
        usedPercent: resolveZaiUsedPercent(limit),
        remaining: typeof limit?.remaining === "number" ? limit.remaining : undefined,
      }))
      .filter((limit: { usedPercent?: number; remaining?: number }) => limit.usedPercent !== undefined)

    let primary: { usedPercent: number } | undefined
    for (const next of enriched) {
      if (next.usedPercent === undefined) continue
      if (!primary || next.usedPercent > primary.usedPercent) {
        primary = { usedPercent: next.usedPercent }
      }
    }

    const limitReached = limits.some((limit: any) => {
      const percent = resolveZaiUsedPercent(limit)
      if (typeof percent === "number" && percent >= 100) return true
      if (typeof limit?.remaining === "number" && limit.remaining <= 0) return true
      return false
    })

    return {
      planType: detailedPlan,
      allowed: !limitReached,
      limitReached,
      limits: primary
        ? {
            primary: {
              usedPercent: primary.usedPercent,
              label: "Quota",
            },
          }
        : undefined,
    }
  }

  function resolveZaiUsedPercent(limit: any): number | undefined {
    if (typeof limit?.percentage === "number") return limit.percentage
    const total = typeof limit?.usage === "number" ? limit.usage : undefined
    const used =
      typeof limit?.currentValue === "number"
        ? limit.currentValue
        : total !== undefined && typeof limit?.remaining === "number"
          ? Math.max(0, total - limit.remaining)
          : undefined
    if (total && used !== undefined && total > 0) {
      return (used / total) * 100
    }
    return undefined
  }

  function formatZaiLimitRow(limit: any, idx: number): string {
    const label = formatZaiLimitLabel(limit, idx)
    const total = typeof limit?.usage === "number" ? limit.usage : undefined
    const used =
      typeof limit?.currentValue === "number"
        ? limit.currentValue
        : total !== undefined && typeof limit?.remaining === "number"
          ? Math.max(0, total - limit.remaining)
          : undefined
    const percent = resolveZaiUsedPercent(limit)

    if (total !== undefined && used !== undefined) {
      const percentLabel = percent !== undefined ? ` (${percent.toFixed(0)}%)` : ""
      return `${label}: ${used.toLocaleString()} / ${total.toLocaleString()}${percentLabel}`
    }
    if (percent !== undefined) {
      return `${label}: ${percent.toFixed(0)}% used`
    }
    return `${label}: usage unknown`
  }

  function formatZaiLimitLabel(limit: any, idx: number): string {
    const type = typeof limit?.type === "string" ? limit.type : undefined
    if (!type) return `Limit #${idx + 1}`
    switch (type) {
      case "TIME_LIMIT":
        return "Time limit"
      case "TOKENS_LIMIT":
        return "Token limit"
      default:
        return type.replace(/_/g, " ").toLowerCase()
    }
  }

  async function fetchMinimaxUsage(input: {
    provider: Provider.Info
    sessionID?: string
    timePeriod?: TimePeriod
  }): Promise<Omit<Record, "providerID" | "providerName" | "fetchedAt">> {
    const sessionData = await fetchSessionUsage(input)

    let limitSummary:
      | {
          planType?: string
          allowed?: boolean
          limitReached?: boolean
          limits?: { primary?: RateLimitWindowSummary }
        }
      | undefined
    let limitError: string | undefined

    const auth = await Auth.get(input.provider.id)
    if (auth?.type === "api" && auth.groupId) {
      const apiKey = auth.key || input.provider.key || input.provider.options?.apiKey
      if (apiKey) {
        limitSummary = await fetchMinimaxUsageLimits(auth.groupId, apiKey).catch((error) => {
          limitError = error instanceof Error ? error.message : String(error)
          return undefined
        })
      }
    }

    const record: Omit<Record, "providerID" | "providerName" | "fetchedAt"> = {
      ...sessionData,
    }

    if (limitSummary) {
      record.planType = limitSummary.planType
      record.allowed = limitSummary.allowed
      record.limitReached = limitSummary.limitReached
      record.limits = limitSummary.limits
    }

    if (limitError) {
      record.error = limitError
    }

    return record
  }

  async function fetchMinimaxUsageLimits(groupId: string, apiKey: string): Promise<{
    planType?: string
    allowed?: boolean
    limitReached?: boolean
    limits?: { primary?: RateLimitWindowSummary }
  }> {
    const url = `${MINIMAX_USAGE_URL}?GroupId=${encodeURIComponent(groupId)}`
    const response = await globalThis.fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Referer: "https://platform.minimax.io/user-center/payment/coding-plan",
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Authorization failed. Please check your MiniMax API key.")
      }
      throw new Error(`Failed to fetch MiniMax usage limits: ${response.statusText}`)
    }

    const payload = (await response.json().catch(() => null)) as any
    if (!payload || payload.base_resp?.status_code !== 0) {
      const errorMsg = payload?.base_resp?.status_msg || "Unknown error"
      throw new Error(`MiniMax API error: ${errorMsg}`)
    }

    const modelRemains = Array.isArray(payload.model_remains) ? payload.model_remains : []
    if (modelRemains.length === 0) {
      return {}
    }

    const model = modelRemains[0]
    const totalCount = typeof model.current_interval_total_count === "number" ? model.current_interval_total_count : 0
    const remainingCount = typeof model.current_interval_usage_count === "number" ? model.current_interval_usage_count : 0
    const remainsTime = typeof model.remains_time === "number" ? model.remains_time : 0
    const modelName = typeof model.model_name === "string" ? model.model_name : "MiniMax"

    const usedCount = totalCount > 0 ? totalCount - remainingCount : 0
    const remainingPercent = totalCount > 0 ? (remainingCount / totalCount) * 100 : 100
    const usedPercent = totalCount > 0 ? (usedCount / totalCount) * 100 : 0

    const limitReached = usedCount >= totalCount && totalCount > 0

    const planType = `${modelName}\n- ${remainingCount.toLocaleString()} / ${totalCount.toLocaleString()} requests remaining (${remainingPercent.toFixed(1)}%)\n- Time remaining: ${formatMilliseconds(remainsTime)}`

    const resetsAt = remainsTime > 0 ? Math.floor((Date.now() + remainsTime) / 1000) : undefined

    return {
      planType,
      allowed: !limitReached,
      limitReached,
      limits: {
        primary: {
          usedPercent: remainingPercent,
          resetsAt,
          label: "Request quota",
        },
      },
    }
  }

  function formatMilliseconds(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) {
      return `${days}d ${hours % 24}h`
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`
    }
    return `${seconds}s`
  }

  async function ensureAnthropicAccessToken(auth: Extract<Auth.Info, { type: "oauth" }>, providerID: string): Promise<string> {
    let token = auth.access
    if (!token || auth.expires <= Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      const refreshed = await refreshAnthropicToken(auth.refresh)
      if (refreshed.type === "failed") {
        throw new Error("Failed to refresh Anthropic token. Run `arctic auth login` to reconnect your account.")
      }

      const updated: Extract<Auth.Info, { type: "oauth" }> = {
        type: "oauth",
        access: refreshed.access!,
        refresh: refreshed.refresh!,
        expires: refreshed.expires!,
      }
      await Auth.set(providerID, updated)
      token = refreshed.access!
    }
    return token
  }

  async function fetchAnthropicUsage(input: {
    provider: Provider.Info
  }): Promise<Omit<Record, "providerID" | "providerName" | "fetchedAt">> {
    let token: string | undefined
    const auth = await Auth.get(input.provider.id)

    if (auth?.type === "api") {
      token = auth.key
    } else if (auth?.type === "oauth") {
      token = await ensureAnthropicAccessToken(auth, input.provider.id)
    } else if (auth?.type === "wellknown") {
      token = auth.token || auth.key
    }

    if (!token) {
      token = input.provider.key ?? input.provider.options?.apiKey
    }

    if (!token) {
      throw new Error("Anthropic authentication is required. Set an OAuth token or API key for provider 'anthropic'.")
    }

    const response = await globalThis.fetch(ANTHROPIC_OAUTH_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "Arctic",
      },
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Authorization failed. Please check your Anthropic OAuth token.")
      }
      throw new Error(`Failed to fetch Anthropic usage: ${response.statusText}`)
    }

    const payload = (await response.json().catch(() => null)) as any
    if (!payload || typeof payload !== "object") {
      return {}
    }

    const fiveHour = payload.five_hour
    const sevenDay = payload.seven_day

    const rows = [formatAnthropicUsageRow("5-hour", fiveHour), formatAnthropicUsageRow("7-day", sevenDay)].filter(
      (row): row is string => Boolean(row),
    )

    const planType = rows.length > 0 ? `Claude subscription\n${rows.map((row) => `- ${row}`).join("\n")}` : undefined

    const primary = resolveAnthropicLimit(fiveHour, "5h")
    const secondary = resolveAnthropicLimit(sevenDay, "Weekly")

    const limitReached = [primary?.usedPercent, secondary?.usedPercent].some(
      (value) => typeof value === "number" && value >= 100,
    )

    return {
      planType,
      allowed: !limitReached,
      limitReached,
      limits: {
        primary: primary ?? undefined,
        secondary: secondary ?? undefined,
      },
    }
  }

  function resolveAnthropicLimit(data: any, label?: string): RateLimitWindowSummary | undefined {
    if (!data || typeof data !== "object") return undefined
    const utilization = typeof data.utilization === "number" ? data.utilization : undefined
    const resetsAt = resolveAnthropicReset(data.resets_at)
    if (utilization === undefined && resetsAt === undefined) return undefined
    return {
      usedPercent: utilization ?? null,
      resetsAt,
      label,
    }
  }

  function resolveAnthropicReset(value: any): number | undefined {
    if (!value || typeof value !== "string") return undefined
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return undefined
    return Math.floor(date.getTime() / 1000)
  }

  function formatAnthropicUsageRow(label: string, data: any): string | undefined {
    if (!data || typeof data !== "object") return undefined
    const utilization = typeof data.utilization === "number" ? data.utilization : undefined
    if (utilization === undefined) return undefined
    const resetsAt = resolveAnthropicReset(data.resets_at)
    const resetLabel = resetsAt ? formatAnthropicTimeRemaining(resetsAt) : undefined
    return `${label}: ${utilization.toFixed(0)}% used${resetLabel ? ` (${resetLabel})` : ""}`
  }

  function formatAnthropicTimeRemaining(resetsAt: number): string {
    const now = Date.now()
    const resetTime = resetsAt * 1000
    const diff = resetTime - now

    if (diff <= 0) return "resetting soon"

    const totalMinutes = Math.floor(diff / 60000)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    const days = Math.floor(hours / 24)
    const hoursInDay = hours % 24

    if (days > 0) return `${days}d ${hoursInDay}h left`
    if (hours > 0) return `${hours}h ${minutes}m left`
    return `${minutes}m left`
  }

  function getTimeFilter(period: TimePeriod, now: number): (timestamp: number) => boolean {
    switch (period) {
      case "session":
        return () => true // No time filter for session mode

      case "daily": {
        const startOfDay = new Date(now)
        startOfDay.setHours(0, 0, 0, 0)
        return (timestamp: number) => timestamp >= startOfDay.getTime()
      }

      case "weekly": {
        const startOfWeek = new Date(now)
        // Get current day (0 = Sunday, 1 = Monday, etc.)
        const currentDay = startOfWeek.getDay()
        // Calculate days to subtract to get to Monday
        // If Sunday (0), go back 6 days. Otherwise go back (currentDay - 1) days
        const daysToMonday = currentDay === 0 ? 6 : currentDay - 1
        startOfWeek.setDate(startOfWeek.getDate() - daysToMonday)
        startOfWeek.setHours(0, 0, 0, 0)
        return (timestamp: number) => timestamp >= startOfWeek.getTime()
      }

      case "monthly": {
        const startOfMonth = new Date(now)
        startOfMonth.setDate(1)
        startOfMonth.setHours(0, 0, 0, 0)
        return (timestamp: number) => timestamp >= startOfMonth.getTime()
      }

      default:
        return () => true
    }
  }

  async function fetchCodexUsage(input: {
    provider: Provider.Info
  }): Promise<Omit<Record, "providerID" | "providerName" | "fetchedAt">> {
    const directAuth = await Auth.get(input.provider.id)
    const baseKey = input.provider.baseProvider ?? input.provider.id
    const baseAuth = baseKey !== input.provider.id ? await Auth.get(baseKey) : undefined
    const auth = directAuth ?? baseAuth
    if (!auth) {
      throw new Error("Codex authentication is required. Run `arctic auth codex` to connect your account.")
    }

    const authKey = directAuth ? input.provider.id : baseKey
    const { accessToken, accountId } = await resolveCodexCredentials(auth, authKey)
    const payload = await fetchCodexUsagePayload({
      baseUrl: resolveCodexBaseUrl(auth),
      accessToken,
      accountId,
    })
    const rateLimit = payload.rate_limit ?? undefined

    return {
      planType: payload.plan_type,
      allowed: rateLimit?.allowed,
      limitReached: rateLimit?.limit_reached,
      limits: {
        primary: mapCodexWindow(rateLimit?.primary_window, "5h"),
        secondary: mapCodexWindow(rateLimit?.secondary_window, "Weekly"),
      },
      credits: mapCredits(payload.credits),
    }
  }

  function mapCodexWindow(
    window: CodexRateLimitWindowSnapshot | null | undefined,
    label?: string,
  ): RateLimitWindowSummary | undefined {
    if (!window) return undefined
    return {
      usedPercent: typeof window.used_percent === "number" ? window.used_percent : null,
      windowMinutes: window.limit_window_seconds > 0 ? Math.ceil(window.limit_window_seconds / 60) : undefined,
      resetsAt: typeof window.reset_at === "number" ? window.reset_at : undefined,
      label,
    }
  }

  function mapCredits(details: CodexCreditsDetails | null | undefined): CreditsSummary | undefined {
    if (!details) return undefined

    return {
      hasCredits: details.has_credits,
      unlimited: details.unlimited,
      balance: details.balance ?? undefined,
    }
  }

  function resolveCodexBaseUrl(auth: Auth.Info): string | undefined {
    const override = process.env.ARCTIC_CODEX_BASE_URL ?? process.env.CODEX_BASE_URL ?? process.env.CHATGPT_BASE_URL
    if (override && override.trim().length > 0) {
      return override
    }
    if (auth.type === "oauth" && auth.enterpriseUrl && auth.enterpriseUrl.trim().length > 0) {
      return auth.enterpriseUrl
    }
    return undefined
  }

  const TOKEN_REFRESH_BUFFER_MS = 60 * 1000

  async function resolveCodexCredentials(auth: Auth.Info, providerID: string): Promise<{ accessToken: string; accountId: string }> {
    if (auth.type === "codex") {
      const accessToken = await CodexClient.ensureValidTokenFor(providerID, auth)
      const accountId = resolveAccountId(auth.accountId, auth.idToken ?? accessToken)
      return { accessToken, accountId }
    }

    if (auth.type === "oauth") {
      const accessToken = await ensureOauthAccessToken(auth, providerID)
      const accountId = resolveAccountId(undefined, accessToken)
      return { accessToken, accountId }
    }

    throw new Error("Codex authentication is required. Run `arctic auth codex` to connect your account.")
  }

  async function ensureOauthAccessToken(auth: Extract<Auth.Info, { type: "oauth" }>, providerID: string): Promise<string> {
    let token = auth.access
    if (!token || auth.expires <= Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      const refreshed = await refreshAccessToken(auth.refresh)
      if (refreshed.type === "failed") {
        throw new Error("Failed to refresh Codex token. Run `arctic auth codex` to reconnect your account.")
      }

      const updated: Extract<Auth.Info, { type: "oauth" }> = {
        type: "oauth",
        access: refreshed.access,
        refresh: refreshed.refresh,
        expires: refreshed.expires,
        enterpriseUrl: auth.enterpriseUrl,
      }
      await Auth.set(providerID, updated)
      token = refreshed.access
    }
    return token
  }

  function resolveAccountId(accountId: string | undefined, tokenSource: string): string {
    if (accountId) return accountId
    const decoded = decodeJWT(tokenSource)
    const claims = decoded?.[JWT_CLAIM_PATH] as { chatgpt_account_id?: string } | undefined
    if (claims?.chatgpt_account_id) return claims.chatgpt_account_id
    throw new Error("Could not determine your ChatGPT account ID. Run `arctic auth codex` to refresh your login.")
  }

  async function fetchGithubCopilotUsageWrapper(input: {
    provider: Provider.Info
  }): Promise<Omit<Record, "providerID" | "providerName" | "fetchedAt">> {
    const auth = await Auth.get(input.provider.id)

    if (!auth) {
      throw new Error("GitHub authentication is required. Run `arctic auth login` and select GitHub Copilot.")
    }

    // Support multiple auth types:
    // - 'oauth': GitHub Copilot's OAuth flow (uses refresh token which is the GitHub OAuth token)
    // - 'github': Custom GitHub auth type (with token property)
    // - 'api': API key auth (with key property)
    let token: string
    if (auth.type === "oauth") {
      // For OAuth, use the refresh token (this is the GitHub OAuth access token)
      token = auth.refresh
    } else if (auth.type === "github") {
      token = auth.token
    } else if (auth.type === "api") {
      token = auth.key
    } else {
      throw new Error("GitHub Copilot requires OAuth, API key, or GitHub token authentication.")
    }

    const [payload, userInfo] = await Promise.all([
      fetchGithubCopilotUsage({ token }),
      fetchGithubUser({ token }).catch(() => null),
    ])

    // Check if quota_snapshots exists
    if (!payload.quota_snapshots || typeof payload.quota_snapshots !== "object") {
      // Return basic info without quota details
      return {
        planType: payload.copilot_plan || "Unknown",
        credits: {
          hasCredits: payload.chat_enabled || false,
          unlimited: true,
        },
        accountId: userInfo ? String(userInfo.id) : undefined,
        accountUsername: userInfo?.login,
      }
    }

    // Build quota details from object
    const quotaEntries = Object.entries(payload.quota_snapshots)
      .filter(([_, snapshot]) => snapshot !== undefined)
      .map(([key, snapshot]) => {
        const quota = snapshot as QuotaSnapshot
        if (quota.unlimited) {
          return `${key}: unlimited`
        }
        const used = quota.entitlement - quota.remaining
        return `${key}: ${used.toLocaleString()}/${quota.entitlement.toLocaleString()}`
      })

    const quotaDetails = quotaEntries.map((entry) => `- ${entry}`).join("\n")

    // Find the most restrictive quota (lowest percent_remaining that's not unlimited)
    let lowestPercent = 100
    let primaryQuota: QuotaSnapshot | null = null

    for (const snapshot of Object.values(payload.quota_snapshots)) {
      if (!snapshot || snapshot.unlimited) continue
      if (snapshot.percent_remaining < lowestPercent) {
        lowestPercent = snapshot.percent_remaining
        primaryQuota = snapshot
      }
    }

    // Parse quota reset date
    let resetsAt: number | undefined
    if (payload.quota_reset_date_utc || payload.quota_reset_date) {
      const resetDate = new Date(payload.quota_reset_date_utc || payload.quota_reset_date)
      resetsAt = Math.floor(resetDate.getTime() / 1000)
    }

    // Determine if any quota limit is reached
    const limitReached = primaryQuota !== null && primaryQuota.percent_remaining <= 0

    // Check if all quotas are unlimited
    const allUnlimited = Object.values(payload.quota_snapshots).every((snapshot) => !snapshot || snapshot.unlimited)

    return {
      planType: `${payload.access_type_sku.replace(/_/g, " ")} - ${payload.copilot_plan}\n${quotaDetails}`,
      allowed: !limitReached,
      limitReached,
      limits: primaryQuota
        ? {
            primary: {
              usedPercent: 100 - primaryQuota.percent_remaining,
              resetsAt,
              label: "Monthly",
            },
          }
        : undefined,
      credits: {
        hasCredits: true,
        unlimited: allUnlimited,
      },
      accountId: userInfo ? String(userInfo.id) : undefined,
      accountUsername: userInfo?.login,
    }
  }

  async function fetchGoogleUsage(input: {
    provider: Provider.Info
  }): Promise<Omit<Record, "providerID" | "providerName" | "fetchedAt">> {
    const debugFile = path.join(Global.Path.log, "google-usage-debug.log")
    const logDebug = async (message: string, data?: { [key: string]: unknown }) => {
      const safe = data ? JSON.stringify(data) : ""
      const line = `[${new Date().toISOString()}] ${message}${safe ? ` ${safe}` : ""}\n`
      await fs.appendFile(debugFile, line).catch(() => {})
    }

    const readResponseBody = async (response: any): Promise<string> => {
      if (response && typeof response.text === "function") {
        return await response.text().catch(() => "[read text failed]")
      }
      if (response && typeof response.json === "function") {
        return await response
          .json()
          .then((data: unknown) => JSON.stringify(data))
          .catch(() => "[read json failed]")
      }
      return "[no body reader]"
    }

    const responseMeta = (response: any) => {
      const headers =
        response && response.headers && typeof response.headers.entries === "function"
          ? Object.fromEntries(response.headers.entries())
          : undefined
      return {
        status: response?.status,
        statusText: response?.statusText,
        headers,
        hasText: typeof response?.text === "function",
        hasJson: typeof response?.json === "function",
        hasArrayBuffer: typeof response?.arrayBuffer === "function",
        type: response ? Object.prototype.toString.call(response) : "undefined",
        ctor: response?.constructor?.name,
        keys: response ? Object.keys(response) : undefined,
      }
    }

    await logDebug("fetchGoogleUsage.start")
    const auth = await Auth.get(input.provider.id)
    if (!auth || auth.type !== "oauth") {
      await logDebug("auth.missing_or_invalid")
      throw new Error("Google OAuth authentication is required. Run `arctic auth login` and select Google.")
    }

    const codeAssistHeaders = {
      "User-Agent": "google-api-nodejs-client/9.15.1",
      "X-Goog-Api-Client": "gl-node/22.17.0",
      "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
    }

    function parseRefreshParts(refresh: string): {
      refreshToken: string
      projectId?: string
      managedProjectId?: string
    } {
      const [refreshToken = "", projectId = "", managedProjectId = ""] = (refresh ?? "").split("|")
      return {
        refreshToken,
        projectId: projectId || undefined,
        managedProjectId: managedProjectId || undefined,
      }
    }

    function formatRefreshParts(parts: {
      refreshToken: string
      projectId?: string
      managedProjectId?: string
    }): string {
      if (!parts.refreshToken) {
        return ""
      }
      if (!parts.projectId && !parts.managedProjectId) {
        return parts.refreshToken
      }
      const projectSegment = parts.projectId ?? ""
      const managedSegment = parts.managedProjectId ?? ""
      return `${parts.refreshToken}|${projectSegment}|${managedSegment}`
    }

    async function ensureGoogleAccessToken(auth: Extract<Auth.Info, { type: "oauth" }>, providerID: string): Promise<string> {
      const refreshParts = parseRefreshParts(auth.refresh)
      let token = auth.access
      if (!token || auth.expires <= Date.now() + 5 * 60 * 1000) {
        await logDebug("accessToken.refreshing")
        const client = new OAuth2Client({
          clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
          clientSecret: "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",
        })

        client.setCredentials({
          refresh_token: refreshParts.refreshToken || auth.refresh,
          access_token: auth.access,
          expiry_date: auth.expires,
        })

        const { token: accessToken } = await client.getAccessToken()

        if (!accessToken) {
          await logDebug("accessToken.refresh_failed")
          throw new Error("Failed to refresh Google access token. Re-authenticate with `arctic auth login`.")
        }

        const updated: Extract<Auth.Info, { type: "oauth" }> = {
          type: "oauth",
          access: accessToken,
          refresh: auth.refresh,
          expires: auth.expires,
        }
        await Auth.set(providerID, updated)
        token = accessToken
        await logDebug("accessToken.refresh_success")
      }
      return token
    }

    async function loadManagedProject(accessToken: string, projectId?: string): Promise<any | null> {
      const metadata: { [key: string]: string } = {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      }
      if (projectId) {
        metadata.duetProject = projectId
      }

      const requestBody: { [key: string]: unknown } = { metadata }
      if (projectId) {
        requestBody.cloudaicompanionProject = projectId
      }

      let response: any
      try {
        response = await globalThis.fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            ...codeAssistHeaders,
          },
          body: JSON.stringify(requestBody),
        })
      } catch (error) {
        await logDebug("loadCodeAssist.error", {
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      }

      if (!response.ok) {
        const errorText = await readResponseBody(response)
        await logDebug("loadCodeAssist.failed", { ...responseMeta(response), body: errorText })
        return null
      }

      const payload = await response.json()
      await logDebug("loadCodeAssist.ok", {
        hasProject: Boolean(payload?.cloudaicompanionProject),
        currentTier: payload?.currentTier?.id ?? null,
      })
      return payload
    }

    async function onboardManagedProject(
      accessToken: string,
      tierId: string,
      projectId?: string,
      attempts = 10,
      delayMs = 5000,
    ): Promise<string | undefined> {
      const metadata: { [key: string]: string } = {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      }
      if (projectId) {
        metadata.duetProject = projectId
      }

      const requestBody: { [key: string]: unknown } = {
        tierId,
        metadata,
      }

      if (tierId !== "FREE" && !projectId) {
        throw new Error("Google Gemini requires a Google Cloud project. Set GOOGLE_CLOUD_PROJECT.")
      }

      if (projectId) {
        requestBody.cloudaicompanionProject = projectId
      }

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        let response: any
        try {
          response = await globalThis.fetch("https://cloudcode-pa.googleapis.com/v1internal:onboardUser", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
              ...codeAssistHeaders,
            },
            body: JSON.stringify(requestBody),
          })
        } catch (error) {
          await logDebug("onboardUser.error", {
            error: error instanceof Error ? error.message : String(error),
          })
          return undefined
        }

        if (!response.ok) {
          const errorText = await readResponseBody(response)
          await logDebug("onboardUser.failed", { ...responseMeta(response), body: errorText })
          return undefined
        }

        const payload = await response.json()
        await logDebug("onboardUser.ok", { done: payload?.done ?? null })
        const managedProjectId = payload?.response?.cloudaicompanionProject?.id
        if (payload?.done && managedProjectId) {
          return managedProjectId
        }
        if (payload?.done && projectId) {
          return projectId
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }

      return undefined
    }

    async function ensureProjectContext(
      accessToken: string,
      auth: Extract<Auth.Info, { type: "oauth" }>,
      providerID: string,
    ): Promise<string> {
      const configuredProjectId =
        process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT ?? process.env.GCLOUD_PROJECT
      if (configuredProjectId && configuredProjectId.trim().length > 0) {
        await logDebug("project.configured", { projectId: configuredProjectId.trim() })
        return configuredProjectId.trim()
      }

      const refreshParts = parseRefreshParts(auth.refresh)
      const projectId = refreshParts.projectId
      if (projectId || refreshParts.managedProjectId) {
        await logDebug("project.from_refresh", {
          projectId: projectId ?? null,
          managedProjectId: refreshParts.managedProjectId ?? null,
        })
        return projectId || refreshParts.managedProjectId || ""
      }

      const loadPayload = await loadManagedProject(accessToken, projectId)
      if (loadPayload?.cloudaicompanionProject) {
        const updated: Extract<Auth.Info, { type: "oauth" }> = {
          type: "oauth",
          access: auth.access,
          refresh: formatRefreshParts({
            refreshToken: refreshParts.refreshToken || auth.refresh,
            projectId: refreshParts.projectId,
            managedProjectId: loadPayload.cloudaicompanionProject,
          }),
          expires: auth.expires,
        }
        await Auth.set(providerID, updated)
        await logDebug("project.from_load", { managedProjectId: loadPayload.cloudaicompanionProject })
        return loadPayload.cloudaicompanionProject
      }

      if (!loadPayload) {
        await logDebug("project.load_failed")
        throw new Error(
          "Google Gemini requires a Google Cloud project. Enable Gemini for Google Cloud API and set GOOGLE_CLOUD_PROJECT.",
        )
      }

      const currentTierId = loadPayload?.currentTier?.id ?? undefined
      if (currentTierId && currentTierId !== "FREE") {
        throw new Error("Google Gemini requires a Google Cloud project for non-free tiers.")
      }

      const allowedTiers = Array.isArray(loadPayload?.allowedTiers) ? loadPayload.allowedTiers : []
      let defaultTierId: string | undefined
      for (const tier of allowedTiers) {
        if (tier?.isDefault) {
          defaultTierId = tier.id
          break
        }
      }
      const tierId = defaultTierId ?? allowedTiers[0]?.id ?? "FREE"

      if (tierId !== "FREE") {
        await logDebug("project.non_free_tier", { tierId })
        throw new Error("Google Gemini requires a Google Cloud project for non-free tiers.")
      }

      const managedProjectId = await onboardManagedProject(accessToken, tierId, projectId)
      if (managedProjectId) {
        const updated: Extract<Auth.Info, { type: "oauth" }> = {
          type: "oauth",
          access: auth.access,
          refresh: formatRefreshParts({
            refreshToken: refreshParts.refreshToken || auth.refresh,
            projectId: refreshParts.projectId,
            managedProjectId,
          }),
          expires: auth.expires,
        }
        await Auth.set(providerID, updated)
        await logDebug("project.onboarded", { managedProjectId })
        return managedProjectId
      }

      await logDebug("project.onboard_failed")
      throw new Error(
        "Google Gemini requires a Google Cloud project. Enable Gemini for Google Cloud API and set GOOGLE_CLOUD_PROJECT.",
      )
    }

    const accessToken = await ensureGoogleAccessToken(auth, input.provider.id)
    const projectId = await ensureProjectContext(accessToken, auth, input.provider.id)
    await logDebug("quota.request", { projectId })

    const res = await globalThis.fetch("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...codeAssistHeaders,
      },
      body: JSON.stringify({ project: projectId }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      await logDebug("quota.failed", { status: res.status, body: errorText })
      throw new Error(`Gemini quota request failed: ${res.status} ${errorText}`)
    }

    const payload = await res.json()
    await logDebug("quota.ok", { buckets: Array.isArray(payload?.buckets) ? payload.buckets.length : 0 })
    const buckets = Array.isArray(payload?.buckets) ? payload.buckets : []
    if (buckets.length === 0) {
      return {
        planType: "Gemini Code Assist",
      }
    }

    const quotaEntries = buckets.map((bucket: any) => {
      const model = bucket.modelId || "Unknown Model"
      const type = bucket.tokenType || "Unknown Type"
      const remaining =
        typeof bucket.remainingFraction === "number" ? `${(bucket.remainingFraction * 100).toFixed(1)}%` : "N/A"
      return `${model} ${type} ${remaining}`
    })
    const quotaDetails = quotaEntries.map((entry: string) => `- ${entry}`).join("\n")

    let lowestRemaining = 1
    let resetTime: string | undefined
    for (const bucket of buckets) {
      if (typeof bucket.remainingFraction === "number" && bucket.remainingFraction < lowestRemaining) {
        lowestRemaining = bucket.remainingFraction
        resetTime = bucket.resetTime
      }
    }

    let resetsAt: number | undefined
    if (resetTime) {
      const resetDate = new Date(resetTime)
      if (!Number.isNaN(resetDate.getTime())) {
        resetsAt = Math.floor(resetDate.getTime() / 1000)
      }
    }

    const usedPercent = Math.max(0, Math.min(100, (1 - lowestRemaining) * 100))
    const limitReached = lowestRemaining <= 0

    return {
      planType: `Gemini Code Assist\n${quotaDetails}`,
      allowed: !limitReached,
      limitReached,
      limits: {
        primary: {
          usedPercent,
          resetsAt,
          label: "Daily",
        },
      },
      credits: {
        hasCredits: true,
        unlimited: false,
      },
    }
  }

  async function fetchKimiUsage(input: {
    provider: Provider.Info
  }): Promise<Omit<Record, "providerID" | "providerName" | "fetchedAt">> {
    const auth = await Auth.get(input.provider.id)
    if (!auth) {
      throw new Error("Kimi authentication is required. Run `arctic auth login` and select Kimi.")
    }

    let token: string | undefined
    if (auth.type === "api") {
      token = auth.key
    } else if (auth.type === "oauth") {
      token = auth.access
    }

    if (!token) {
      throw new Error("Kimi authentication token is missing.")
    }

    const response = await globalThis.fetch("https://api.kimi.com/coding/v1/usages", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      if (response.status === 401) throw new Error("Authorization failed. Please check your API key.")
      if (response.status === 404) throw new Error("Usage endpoint not available. Try Kimi For Coding.")
      throw new Error(`Failed to fetch usage: ${response.statusText}`)
    }

    const payload = (await response.json()) as any
    
    const weeklyUsage = payload.usage
    const windowedLimits = Array.isArray(payload.limits) ? payload.limits : []
    
    const fiveHourLimit = windowedLimits.find((l: any) => {
      const window = l?.window || {}
      const duration = parseInt(window.duration)
      const timeUnit = window.timeUnit || ""
      return timeUnit.includes("MINUTE") && duration === 300
    })

    const primary = resolveKimiLimitFromDetail(fiveHourLimit?.detail, "5h")
    const secondary = resolveKimiLimitFromDetail(weeklyUsage, "Weekly")

    const rows = [
      formatKimiLimitRow("5-hour", fiveHourLimit?.detail),
      formatKimiLimitRow("Weekly", weeklyUsage),
    ].filter((row): row is string => Boolean(row))

    const planType = rows.length > 0 ? `Kimi for Coding\n${rows.map((row) => `- ${row}`).join("\n")}` : "Kimi for Coding"

    const limitReached = [primary?.usedPercent, secondary?.usedPercent].some(
      (value) => typeof value === "number" && value >= 100,
    )

    return {
      planType,
      allowed: !limitReached,
      limitReached,
      limits: {
        primary: primary ?? undefined,
        secondary: secondary ?? undefined,
      },
      credits: {
        hasCredits: true,
        unlimited: !primary && !secondary,
      },
    }
  }

  function resolveKimiLimitFromDetail(detail: any, label?: string): RateLimitWindowSummary | undefined {
    if (!detail) return undefined
    const limit = parseInt(detail.limit)
    const remaining = parseInt(detail.remaining)
    if (isNaN(limit) || limit <= 0) return undefined
    
    const used = limit - (isNaN(remaining) ? 0 : remaining)
    const usedPercent = (used / limit) * 100
    const resetsAt = resolveKimiReset(detail)
    
    return {
      usedPercent,
      resetsAt,
      label,
    }
  }

  function formatKimiLimitRow(label: string, detail: any): string | undefined {
    if (!detail) return undefined
    const limit = parseInt(detail.limit)
    const remaining = parseInt(detail.remaining)
    if (isNaN(limit) || limit <= 0) return undefined
    
    const used = limit - (isNaN(remaining) ? 0 : remaining)
    const usedPercent = (used / limit) * 100
    const resetsAt = resolveKimiReset(detail)
    const resetLabel = resetsAt ? formatKimiTimeRemaining(resetsAt) : undefined
    
    return `${label}: ${usedPercent.toFixed(0)}% used${resetLabel ? ` (${resetLabel})` : ""}`
  }

  function resolveKimiReset(data: any): number | undefined {
    for (const key of ["reset_at", "resetAt", "reset_time", "resetTime", "resets_at"]) {
      if (data[key]) {
        const d = new Date(data[key])
        if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000)
      }
    }
    for (const key of ["reset_in", "resetIn", "ttl", "window"]) {
      const val = parseInt(data[key])
      if (val) return Math.floor(Date.now() / 1000) + val
    }
    return undefined
  }

  function formatKimiTimeRemaining(resetsAt: number): string {
    const now = Date.now()
    const resetTime = resetsAt * 1000
    const diff = resetTime - now

    if (diff <= 0) return "resetting soon"

    const totalMinutes = Math.floor(diff / 60000)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    const days = Math.floor(hours / 24)
    const hoursInDay = hours % 24

    if (days > 0) return `${days}d ${hoursInDay}h left`
    if (hours > 0) return `${hours}h ${minutes}m left`
    return `${minutes}m left`
  }

  async function ensureAntigravityAccessToken(auth: Extract<Auth.Info, { type: "oauth" }>, _providerID: string): Promise<string> {
    const needsRefresh = !auth.access || !auth.expires || auth.expires <= Date.now() + 5 * 60 * 1000

    if (needsRefresh) {
      const { ensureValidToken } = await import("@/auth/antigravity-oauth/token")
      const refreshed = await ensureValidToken(auth as any)
      const token = refreshed.access
      if (!token) {
        throw new Error("Failed to get valid Antigravity access token after refresh.")
      }
      return token
    }

    if (!auth.access) {
      throw new Error("No Antigravity access token available. Run `arctic auth login` to authenticate.")
    }

    return auth.access
  }

  async function fetchAntigravityUsage(input: {
    provider: Provider.Info
    sessionID?: string
    timePeriod?: TimePeriod
  }): Promise<Omit<Record, "providerID" | "providerName" | "fetchedAt">> {
    const auth = await Auth.get(input.provider.id)
    if (!auth || auth.type !== "oauth") {
      throw new Error("Antigravity OAuth authentication is required. Run `arctic auth login` and select Antigravity.")
    }

    const accessToken = await ensureAntigravityAccessToken(auth, input.provider.id)

    // Fetch quota information from Antigravity API
    const quotas = await fetchAntigravityModels(accessToken)

    if (quotas.length === 0) {
      return {
        planType: "Antigravity (No quota information available)",
        credits: {
          hasCredits: true,
          unlimited: true,
        },
      }
    }

    // Find the model with the lowest remaining fraction (most constrained)
    let lowestRemaining = 1.0
    let resetTime: string | null = null

    for (const quota of quotas) {
      const remaining = quota.remainingFraction ?? 1.0
      if (remaining < lowestRemaining) {
        lowestRemaining = remaining
        resetTime = quota.resetTime
      }
    }

    // Format quota details for display
    const quotaEntries = quotas
      .map((quota) => {
        const percent = quota.remainingFraction !== null ? Math.round(quota.remainingFraction * 100) : "N/A"
        return `${quota.displayName}: ${percent}% remaining`
      })
      .slice(0, 10) // Limit to first 10 models to avoid clutter

    const quotaDetails = quotaEntries.map((entry) => `- ${entry}`).join("\n")
    const planType = `Antigravity\n${quotaDetails}`

    // Parse reset time if available
    let resetsAt: number | undefined
    if (resetTime) {
      const resetDate = new Date(resetTime)
      if (!Number.isNaN(resetDate.getTime())) {
        resetsAt = Math.floor(resetDate.getTime() / 1000)
      }
    }

    const usedPercent = Math.max(0, Math.min(100, (1 - lowestRemaining) * 100))
    const limitReached = lowestRemaining <= 0

    // Also fetch session-based token usage if sessionID is provided
    let tokenUsage: TokenUsage | undefined
    let costSummary: CostSummary | undefined

    if (input.sessionID) {
      const sessionData = await fetchSessionUsage(input)
      tokenUsage = sessionData.tokenUsage
      costSummary = sessionData.costSummary
    }

    return {
      planType,
      allowed: !limitReached,
      limitReached,
      limits: {
        primary: {
          usedPercent,
          resetsAt,
          label: "Daily",
        },
      },
      credits: {
        hasCredits: true,
        unlimited: false,
      },
      tokenUsage,
      costSummary,
    }
  }

  async function fetchAlibabaUsage(input: {
    provider: Provider.Info
    sessionID?: string
    timePeriod?: TimePeriod
  }): Promise<Omit<Record, "providerID" | "providerName" | "fetchedAt">> {
    const DAILY_REQUEST_LIMIT = 2000

    // Alibaba quota is DAILY (2000 req/day), not per-session
    // Always count all requests from today, regardless of session context
    const now = Date.now()
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const dayStart = startOfDay.getTime()

    // Always scan all sessions for daily quota
    const messageKeys = await Storage.list(["message"])
    let requestCount = 0

    for (const messageKey of messageKeys) {
      const msg = await Storage.read<MessageV2.Info>(messageKey)

      // Only count assistant messages from alibaba provider (use baseProvider if available for connections)
      const targetProviderID = input.provider.baseProvider ?? input.provider.id
      if (msg.role !== "assistant" || msg.providerID !== targetProviderID) {
        continue
      }

      const messageTime = msg.time?.completed ?? msg.time?.created
      if (!messageTime || messageTime < dayStart) {
        continue
      }

      requestCount++
    }

    const usedPercent = (requestCount / DAILY_REQUEST_LIMIT) * 100
    const remaining = Math.max(0, DAILY_REQUEST_LIMIT - requestCount)
    const limitReached = requestCount >= DAILY_REQUEST_LIMIT

    // Calculate when the quota resets (midnight)
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    const resetsAt = Math.floor(tomorrow.getTime() / 1000)

    return {
      planType: `Qwen OAuth\n- Daily requests: ${requestCount.toLocaleString()} / ${DAILY_REQUEST_LIMIT.toLocaleString()} (${remaining.toLocaleString()} remaining)`,
      allowed: !limitReached,
      limitReached,
      limits: {
        primary: {
          usedPercent,
          resetsAt,
          label: "Daily",
        },
      },
      credits: {
        hasCredits: true,
        unlimited: false,
      },
    }
  }
}
