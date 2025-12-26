import claudePricingData from "./pricings/claude.json"
import glmPricingData from "./pricings/glm.json"
import openaiPricingData from "./pricings/openai.json"

type PricingData = {
  models: Record<string, ModelPricing>
}

const providerPricing: Record<string, PricingData> = {
  arctic: glmPricingData as PricingData,
  claude: claudePricingData as PricingData,
  anthropic: claudePricingData as PricingData,
  "@ai-sdk/anthropic": claudePricingData as PricingData,
  openai: openaiPricingData as PricingData,
  "@ai-sdk/openai": openaiPricingData as PricingData,
  openrouter: undefined as any, // Fetched dynamically
  "@openrouter/ai-sdk-provider": undefined as any, // Alias
}

// OpenRouter API cache with 24-hour TTL
type OpenRouterModel = {
  id: string
  pricing: {
    prompt: string
    completion: string
    request: string
    image: string
    web_search: string
    internal_reasoning: string
    input_cache_read: string
  }
}

type OpenRouterResponse = {
  data: OpenRouterModel[]
}

let openRouterCache: { data: OpenRouterModel[]; timestamp: number } | null = null
const OPENROUTER_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/models"

/**
 * Initialize OpenRouter pricing cache (call early to populate cache for sync access)
 */
export async function initOpenRouterPricing(): Promise<void> {
  await fetchOpenRouterModels()
}

async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  if (
    openRouterCache &&
    Date.now() - openRouterCache.timestamp < OPENROUTER_CACHE_TTL
  ) {
    return openRouterCache.data
  }

  const response = await fetch(OPENROUTER_API_URL)
  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`)
  }

  const data = (await response.json()) as OpenRouterResponse
  openRouterCache = { data: data.data, timestamp: Date.now() }
  return data.data
}

async function getOpenRouterPricing(modelId: string): Promise<ModelPricing | undefined> {
  const models = await fetchOpenRouterModels()
  const model = models.find((m) => m.id === modelId)
  if (!model) return undefined

  // OpenRouter returns per-token pricing as strings, convert to per-million
  const promptPrice = parseFloat(model.pricing.prompt) || 0
  const completionPrice = parseFloat(model.pricing.completion) || 0
  const cacheReadPrice = parseFloat(model.pricing.input_cache_read) || 0

  return {
    input: promptPrice * 1_000_000,
    output: completionPrice * 1_000_000,
    cacheRead: cacheReadPrice > 0 ? cacheReadPrice * 1_000_000 : undefined,
  }
}

export type TokenUsage = {
  input?: number
  output?: number
  cacheCreation?: number
  cacheRead?: number
}

export type CostBreakdown = {
  inputCost: number
  outputCost: number
  cacheCreationCost: number
  cacheReadCost: number
  totalCost: number
}

export type ModelPricing = {
  input: number
  output: number
  cacheWrite?: number
  cacheRead?: number
}

export namespace Pricing {
  /**
   * Detect provider from model ID
   */
  function detectProvider(modelId: string): string | undefined {
    const lowerModel = modelId.toLowerCase()

    // OpenRouter models use "provider/model" format
    if (lowerModel.includes("/")) {
      return "openrouter"
    }

    if (lowerModel.startsWith("claude-") || lowerModel.startsWith("anthropic/")) {
      return "claude"
    }
    if (
      lowerModel.startsWith("gpt-") ||
      lowerModel.startsWith("o1") ||
      lowerModel.startsWith("o3") ||
      lowerModel.startsWith("o4") ||
      lowerModel.includes("codex")
    ) {
      return "openai"
    }
    if (lowerModel.startsWith("glm-")) {
      return "arctic"
    }
    return undefined
  }

  /**
   * Get pricing information for a specific model (sync - local data only)
   */
  export function getModelPricing(modelId: string, provider?: string): ModelPricing | undefined {
    const providerKey = provider || detectProvider(modelId)
    if (!providerKey) return undefined

    // OpenRouter: use cached data if available
    if (providerKey === "openrouter" || providerKey === "@openrouter/ai-sdk-provider") {
      if (!openRouterCache) return undefined
      const model = openRouterCache.data.find((m) => m.id === modelId)
      if (!model) return undefined
      const promptPrice = parseFloat(model.pricing.prompt) || 0
      const completionPrice = parseFloat(model.pricing.completion) || 0
      const cacheReadPrice = parseFloat(model.pricing.input_cache_read) || 0
      return {
        input: promptPrice * 1_000_000,
        output: completionPrice * 1_000_000,
        cacheRead: cacheReadPrice > 0 ? cacheReadPrice * 1_000_000 : undefined,
      }
    }

    const pricingData = providerPricing[providerKey]
    if (!pricingData) return undefined

    const pricing = pricingData.models[modelId]
    if (!pricing) {
      // Try to find by partial match
      const normalizedId = normalizeModelId(modelId)
      for (const [key, value] of Object.entries(pricingData.models)) {
        if (normalizeModelId(key) === normalizedId) {
          return value
        }
      }
      return undefined
    }
    return pricing
  }

  /**
   * Get pricing information for a specific model (async - supports OpenRouter)
   */
  export async function getModelPricingAsync(modelId: string, provider?: string): Promise<ModelPricing | undefined> {
    const providerKey = provider || detectProvider(modelId)
    if (!providerKey) return undefined

    // Handle OpenRouter via API
    if (providerKey === "openrouter" || providerKey === "@openrouter/ai-sdk-provider") {
      return getOpenRouterPricing(modelId)
    }

    // For other providers, use sync lookup
    return getModelPricing(modelId, provider)
  }

  /**
   * Normalize model ID for matching
   */
  function normalizeModelId(modelId: string): string {
    return (
      modelId
        .toLowerCase()
        .replace(/-\d{8}$/, "") // Remove date suffix
        .replace(/[._]/g, "-")
    ) // Normalize separators
  }

  /**
   * Calculate cost for token usage
   */
  export function calculateCost(
    modelId: string,
    usage: TokenUsage,
    options?: {
      provider?: string
    },
  ): CostBreakdown | undefined {
    const pricing = getModelPricing(modelId, options?.provider)
    if (!pricing) {
      return undefined
    }

    const { input = 0, output = 0, cacheCreation = 0, cacheRead = 0 } = usage

    const inputRate = pricing.input
    const outputRate = pricing.output
    const cacheWriteRate = pricing.cacheWrite ?? 0
    const cacheReadRate = pricing.cacheRead ?? 0

    // Calculate costs (prices are per million tokens)
    const inputCost = (input * inputRate) / 1_000_000
    const outputCost = (output * outputRate) / 1_000_000
    const cacheCreationCost = (cacheCreation * cacheWriteRate) / 1_000_000
    const cacheReadCost = (cacheRead * cacheReadRate) / 1_000_000

    const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost

    return {
      inputCost,
      outputCost,
      cacheCreationCost,
      cacheReadCost,
      totalCost,
    }
  }

  /**
   * Calculate cost for token usage (async - supports OpenRouter)
   */
  export async function calculateCostAsync(
    modelId: string,
    usage: TokenUsage,
    options?: {
      provider?: string
    },
  ): Promise<CostBreakdown | undefined> {
    const pricing = await getModelPricingAsync(modelId, options?.provider)
    if (!pricing) {
      return undefined
    }

    const { input = 0, output = 0, cacheCreation = 0, cacheRead = 0 } = usage

    const inputRate = pricing.input
    const outputRate = pricing.output
    const cacheWriteRate = pricing.cacheWrite ?? 0
    const cacheReadRate = pricing.cacheRead ?? 0

    // Calculate costs (prices are per million tokens)
    const inputCost = (input * inputRate) / 1_000_000
    const outputCost = (output * outputRate) / 1_000_000
    const cacheCreationCost = (cacheCreation * cacheWriteRate) / 1_000_000
    const cacheReadCost = (cacheRead * cacheReadRate) / 1_000_000

    const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost

    return {
      inputCost,
      outputCost,
      cacheCreationCost,
      cacheReadCost,
      totalCost,
    }
  }

  /**
   * Format cost as currency string
   */
  export function formatCost(cost: number): string {
    if (cost === 0) return "$0.00"
    if (cost < 0.0001) return `$${cost.toExponential(2)}`
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    if (cost < 1) return `$${cost.toFixed(3)}`
    return `$${cost.toFixed(2)}`
  }

  /**
   * Get all available models
   */
  export function listModels(): string[] {
    const models: string[] = []
    for (const data of Object.values(providerPricing)) {
      models.push(...Object.keys(data.models))
    }
    return models
  }
}
