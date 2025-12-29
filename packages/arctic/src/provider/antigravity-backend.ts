import { ANTIGRAVITY_HEADERS, ANTIGRAVITY_ENDPOINT_FALLBACKS } from "@/auth/antigravity-oauth/constants"

/**
 * Antigravity model quota information from fetchAvailableModels endpoint
 */
export type AntigravityModelQuota = {
  modelId: string
  displayName: string
  remainingFraction: number | null
  resetTime: string | null
}

/**
 * Response from fetchAvailableModels endpoint
 */
type FetchAvailableModelsResponse = {
  models?: Record<
    string,
    {
      displayName?: string
      quotaInfo?: {
        remainingFraction?: number | null
        resetTime?: string | null
      }
    }
  >
}

/**
 * Fetches available models with quota information from Antigravity API
 * POST /v1internal:fetchAvailableModels
 */
export async function fetchAntigravityModels(accessToken: string): Promise<AntigravityModelQuota[]> {
  let lastError: Error | undefined

  for (const endpoint of ANTIGRAVITY_ENDPOINT_FALLBACKS) {
    try {
      const response = await globalThis.fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...ANTIGRAVITY_HEADERS,
        },
        body: JSON.stringify({}),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "")
        lastError = new Error(
          `Failed to fetch models from ${endpoint}: ${response.status} ${response.statusText} ${errorText}`,
        )
        continue
      }

      const data = (await response.json()) as FetchAvailableModelsResponse

      if (!data?.models) {
        lastError = new Error(`No models data in response from ${endpoint}`)
        continue
      }

      const quotas: AntigravityModelQuota[] = []
      for (const [modelId, modelData] of Object.entries(data.models)) {
        if (modelData.quotaInfo) {
          quotas.push({
            modelId,
            displayName: modelData.displayName || modelId,
            remainingFraction: modelData.quotaInfo.remainingFraction ?? null,
            resetTime: modelData.quotaInfo.resetTime ?? null,
          })
        }
      }

      return quotas
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      continue
    }
  }

  throw lastError || new Error("Failed to fetch Antigravity models from all endpoints")
}
