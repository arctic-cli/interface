import { describe, expect, it } from "bun:test"
import { formatUsageSummary, type UsageRecordSummary } from "@/session/usage-format"

describe("SessionUsage.formatUsageSummary", () => {
  const now = Date.UTC(2025, 11, 20, 12, 0, 0) // December 20, 2025 12:00:00 UTC

  it("formats detailed provider usage information", () => {
    const summary = formatUsageSummary(
      [
        {
          providerID: "codex",
          providerName: "Codex",
          planType: "pro",
          allowed: true,
          limitReached: false,
          tokenUsage: {
            total: 1234 + 567 + 89,
            input: 1234,
            output: 567,
            cached: 89,
          },
          limits: {
            primary: {
              usedPercent: 42.4,
              windowMinutes: 300,
              resetsAt: Math.floor(now / 1000) + 90 * 60,
            },
            secondary: {
              usedPercent: 12,
              windowMinutes: 1440,
              resetsAt: Math.floor(now / 1000) + 15 * 60,
            },
          },
          credits: {
            hasCredits: true,
            unlimited: false,
            balance: "$18.00",
          },
          fetchedAt: now,
        },
      ],
      now,
    )

    expect(summary).toContain("╭")
    expect(summary).toContain("Usage summary · 2025-12-20T12:00:00.000Z")
    expect(summary).toContain("Codex (plan: pro)")
    expect(summary).toContain("Access  : allowed")
    expect(summary).toContain("Credits : balance $18.00")
    expect(summary).toContain("Tokens  : total 1.9k · input 1.2k · output 567 · cached 89")
    expect(summary).toContain("Primary   57.6 [████████████░░░░░░░░]  ·  resets in 1h 30m (2025-12-20T13:30:00.000Z)")
    expect(summary).toContain("Secondary 88 [██████████████████░░]  ·  resets in 0h 15m (2025-12-20T12:15:00.000Z)")
  })

  it("includes provider errors", () => {
    const summary = formatUsageSummary(
      [
        {
          providerID: "codex",
          providerName: "Codex",
          error: "not authenticated",
          fetchedAt: now,
        } as UsageRecordSummary,
      ],
      now,
    )

    expect(summary).toContain("Error   : not authenticated")
  })
})
