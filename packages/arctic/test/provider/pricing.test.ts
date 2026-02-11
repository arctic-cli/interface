import { Pricing, initModelsDevPricing } from "@/provider/pricing"
import { beforeAll, describe, expect, test } from "bun:test"

describe("Pricing with models.dev", () => {
  beforeAll(async () => {
    // Initialize pricing cache before tests
    await initModelsDevPricing()
  })

  test("fetches pricing from LiteLLM", async () => {
    const pricing = await Pricing.getModelPricingAsync("claude-3-5-sonnet-20241022")
    expect(pricing).toBeDefined()
    expect(pricing?.input).toBeGreaterThan(0)
    expect(pricing?.output).toBeGreaterThan(0)
  })

  test("calculates cost for Claude model", async () => {
    const cost = await Pricing.calculateCostAsync("claude-3-5-sonnet-20241022", {
      input: 1000,
      output: 500,
    })
    expect(cost).toBeDefined()
    expect(cost?.totalCost).toBeGreaterThan(0)
    expect(cost?.inputCost).toBeGreaterThan(0)
    expect(cost?.outputCost).toBeGreaterThan(0)
  })

  test("handles cache costs", async () => {
    const cost = await Pricing.calculateCostAsync("claude-3-5-sonnet-20241022", {
      input: 1000,
      output: 500,
      cacheCreation: 200,
      cacheRead: 100,
    })
    expect(cost).toBeDefined()
    expect(cost?.totalCost).toBeGreaterThan(0)
  })

  test("normalizes model IDs with provider prefix", async () => {
    const cost1 = await Pricing.calculateCostAsync("claude-3-5-sonnet-20241022", {
      input: 1000,
      output: 500,
    })
    const cost2 = await Pricing.calculateCostAsync("anthropic/claude-3-5-sonnet-20241022", {
      input: 1000,
      output: 500,
    })
    expect(cost1).toBeDefined()
    expect(cost2).toBeDefined()
    // Both should return the same pricing
    expect(cost1?.totalCost).toBe(cost2?.totalCost)
  })

  test("uses fallback pricing for GLM models", async () => {
    const pricing = await Pricing.getModelPricingAsync("glm-4.7")
    expect(pricing).toBeDefined()
    expect(pricing?.input).toBe(0.6)
    expect(pricing?.output).toBe(2.2)
    expect(pricing?.cacheRead).toBe(0.11)
  })

  test("uses fallback pricing for GLM models with provider prefix", async () => {
    const pricing = await Pricing.getModelPricingAsync("zai-coding-plan/glm-4.7")
    expect(pricing).toBeDefined()
    expect(pricing?.input).toBe(0.6)
    expect(pricing?.output).toBe(2.2)
  })

  test("uses fallback pricing for Antigravity models", async () => {
    const pricing1 = await Pricing.getModelPricingAsync("antigravity/claude-sonnet-4-5-thinking")
    expect(pricing1).toBeDefined()
    expect(pricing1?.input).toBe(3)
    expect(pricing1?.output).toBe(15)

    const pricing2 = await Pricing.getModelPricingAsync("antigravity/claude-opus-4-5-thinking")
    expect(pricing2).toBeDefined()
    expect(pricing2?.input).toBe(5)
    expect(pricing2?.output).toBe(25)
  })

  test("uses fallback pricing for K2P5 model", async () => {
    const pricing = await Pricing.getModelPricingAsync("K2P5")
    expect(pricing).toBeDefined()
    expect(pricing?.input).toBe(0.6)
    expect(pricing?.output).toBe(3)
    expect(pricing?.cacheRead).toBe(0.1)
  })

  test("uses fallback pricing for K2P5 model with provider prefix", async () => {
    const pricing = await Pricing.getModelPricingAsync("some-provider/K2P5")
    expect(pricing).toBeDefined()
    expect(pricing?.input).toBe(0.6)
    expect(pricing?.output).toBe(3)
    expect(pricing?.cacheRead).toBe(0.1)
  })

  test("uses fallback pricing for lowercase k2p5 model", async () => {
    const pricing = await Pricing.getModelPricingAsync("k2p5")
    expect(pricing).toBeDefined()
    expect(pricing?.input).toBe(0.6)
    expect(pricing?.output).toBe(3)
    expect(pricing?.cacheRead).toBe(0.1)
  })

  test("uses fallback pricing for kimi-for-coding/k2p5 model", async () => {
    const pricing = await Pricing.getModelPricingAsync("kimi-for-coding/k2p5")
    expect(pricing).toBeDefined()
    expect(pricing?.input).toBe(0.6)
    expect(pricing?.output).toBe(3)
    expect(pricing?.cacheRead).toBe(0.1)
  })

  test("calculates cost for fallback models", async () => {
    const cost = await Pricing.calculateCostAsync("zai-coding-plan/glm-4.7", {
      input: 1000000,
      output: 500000,
    })
    expect(cost).toBeDefined()
    expect(cost?.totalCost).toBeCloseTo(0.8, 1)
  })

  test("returns undefined for unknown model", async () => {
    const pricing = await Pricing.getModelPricingAsync("unknown-model-12345")
    expect(pricing).toBeUndefined()
  })

  test("formats costs correctly", () => {
    expect(Pricing.formatCost(0)).toBe("$0.00")
    expect(Pricing.formatCost(0.00005)).toBe("$5.00e-5")
    expect(Pricing.formatCost(0.005)).toBe("$0.0050")
    expect(Pricing.formatCost(0.5)).toBe("$0.500")
    expect(Pricing.formatCost(5)).toBe("$5.00")
  })
})

describe("GitHub Copilot multipliers", () => {
  test("detects free plan", () => {
    expect(Pricing.detectCopilotPlanType("copilot_free")).toBe("free")
    expect(Pricing.detectCopilotPlanType("copilot_for_free")).toBe("free")
    expect(Pricing.detectCopilotPlanType("Copilot Free")).toBe("free")
  })

  test("detects paid plan", () => {
    expect(Pricing.detectCopilotPlanType("copilot_business")).toBe("paid")
    expect(Pricing.detectCopilotPlanType("copilot_enterprise")).toBe("paid")
    expect(Pricing.detectCopilotPlanType("copilot_individual")).toBe("paid")
    expect(Pricing.detectCopilotPlanType("copilot_pro")).toBe("paid")
  })

  test("returns correct multipliers for paid plan", () => {
    expect(Pricing.getCopilotMultiplier("claude-haiku-4.5", "paid")).toBe(0.33)
    expect(Pricing.getCopilotMultiplier("claude-opus-41", "paid")).toBe(10)
    expect(Pricing.getCopilotMultiplier("claude-sonnet-4", "paid")).toBe(1)
    expect(Pricing.getCopilotMultiplier("gpt-4.1", "paid")).toBe(0)
    expect(Pricing.getCopilotMultiplier("gpt-5", "paid")).toBe(1)
    expect(Pricing.getCopilotMultiplier("grok-code-fast-1", "paid")).toBe(0.25)
  })

  test("handles -thinking suffix", () => {
    // Should strip -thinking and match claude-sonnet-4.5
    expect(Pricing.getCopilotMultiplier("claude-sonnet-4.5-thinking", "paid")).toBe(1)
    // Should strip -thinking and match claude-opus-4.5
    expect(Pricing.getCopilotMultiplier("claude-opus-4.5-thinking", "paid")).toBe(3)
    // Should handle opus 4 variants (without minor version)
    expect(Pricing.getCopilotMultiplier("claude-opus-4-thinking", "paid")).toBe(10)
    expect(Pricing.getCopilotMultiplier("claude-opus-4.1-thinking", "paid")).toBe(10)
  })

  test("handles normalization with -thinking suffix", () => {
    // Should normalize 4-5 to 4.5 and strip -thinking
    expect(Pricing.getCopilotMultiplier("claude-sonnet-4-5-thinking", "paid")).toBe(1)
  })

  test("returns correct multipliers for free plan", () => {
    expect(Pricing.getCopilotMultiplier("claude-haiku-4.5", "free")).toBe(1)
    expect(Pricing.getCopilotMultiplier("gpt-4.1", "free")).toBe(1)
    expect(Pricing.getCopilotMultiplier("gpt-4o", "free")).toBe(1)
    expect(Pricing.getCopilotMultiplier("gpt-5-mini", "free")).toBe(1)
  })

  test("returns null for models not available on free plan", () => {
    expect(Pricing.getCopilotMultiplier("claude-opus-41", "free")).toBeNull()
    expect(Pricing.getCopilotMultiplier("claude-sonnet-4", "free")).toBeNull()
    expect(Pricing.getCopilotMultiplier("gpt-5", "free")).toBeNull()
    expect(Pricing.getCopilotMultiplier("gemini-2.5-pro", "free")).toBeNull()
  })

  test("returns null for unknown models", () => {
    expect(Pricing.getCopilotMultiplier("unknown-model", "paid")).toBeNull()
    expect(Pricing.getCopilotMultiplier("unknown-model", "free")).toBeNull()
  })

  test("strips provider prefix from model ID", () => {
    expect(Pricing.getCopilotMultiplier("github-copilot/claude-haiku-4.5", "paid")).toBe(0.33)
    expect(Pricing.getCopilotMultiplier("github-copilot/gpt-5", "paid")).toBe(1)
  })

  test("checks model availability", () => {
    expect(Pricing.isCopilotModelAvailable("claude-haiku-4.5", "free")).toBe(true)
    expect(Pricing.isCopilotModelAvailable("claude-opus-41", "free")).toBe(false)
    expect(Pricing.isCopilotModelAvailable("claude-opus-41", "paid")).toBe(true)
  })

  test("lists multipliers for paid plan", () => {
    const multipliers = Pricing.listCopilotMultipliers("paid")
    expect(multipliers["claude-haiku-4.5"]).toBe(0.33)
    expect(multipliers["claude-opus-41"]).toBe(10)
    expect(multipliers["gpt-4.1"]).toBe(0)
    expect(Object.keys(multipliers).length).toBeGreaterThan(10)
  })

  test("lists multipliers for free plan", () => {
    const multipliers = Pricing.listCopilotMultipliers("free")
    expect(multipliers["claude-haiku-4.5"]).toBe(1)
    expect(multipliers["gpt-4.1"]).toBe(1)
    expect(multipliers["claude-opus-41"]).toBeUndefined()
    // Free plan has fewer available models
    expect(Object.keys(multipliers).length).toBeLessThan(10)
  })
})
