import { describe, expect, it } from "bun:test"
import { CODEX_BASE_URL } from "@/auth/codex-oauth/constants"
import { buildCodexUsageUrl, normalizeCodexBaseUrl } from "@/provider/codex-backend"

describe("codex usage backend helpers", () => {
  it("normalizes trailing slashes and falls back to default", () => {
    expect(normalizeCodexBaseUrl(`${CODEX_BASE_URL}////`)).toBe(CODEX_BASE_URL)
  })

  it("adds /backend-api for chatgpt hosts without the suffix", () => {
    expect(normalizeCodexBaseUrl("https://chatgpt.com")).toBe("https://chatgpt.com/backend-api")
    expect(normalizeCodexBaseUrl("https://chat.openai.com")).toBe("https://chat.openai.com/backend-api")
  })

  it("uses /wham/usage when pointing at chatgpt backend hosts", () => {
    const url = buildCodexUsageUrl("https://chatgpt.com/backend-api")
    expect(url).toBe("https://chatgpt.com/backend-api/wham/usage")
  })

  it("falls back to /api/codex/usage for codex api hosts", () => {
    const url = buildCodexUsageUrl("https://codex.openai.com")
    expect(url).toBe("https://codex.openai.com/api/codex/usage")
  })
})
