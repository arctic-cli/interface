import { describe, it, expect } from "bun:test"
import type { CopilotUsageResponse } from "@/provider/github-copilot-backend"

describe("GitHub Copilot Backend", () => {
  it("should have correct type definitions", () => {
    const mockResponse: CopilotUsageResponse = {
      access_type_sku: "business",
      analytics_tracking_id: "test-id",
      assigned_date: "2024-01-01",
      can_signup_for_limited: false,
      chat_enabled: true,
      copilot_plan: "copilot_business",
      organization_login_list: [],
      organization_list: [],
      quota_reset_date: "2024-02-01T00:00:00Z",
      quota_reset_date_utc: "2024-02-01T00:00:00Z",
      quota_snapshots: {
        completions: {
          entitlement: 1000,
          overage_count: 0,
          overage_permitted: false,
          percent_remaining: 90,
          quota_id: "completions",
          quota_remaining: 900,
          remaining: 900,
          unlimited: false,
          timestamp_utc: "2024-02-01T00:00:00Z",
          quota_breakdown: "completions",
        },
        chat: {
          entitlement: 500,
          overage_count: 0,
          overage_permitted: false,
          percent_remaining: 90,
          quota_id: "chat",
          quota_remaining: 450,
          remaining: 450,
          unlimited: false,
          timestamp_utc: "2024-02-01T00:00:00Z",
          quota_breakdown: "chat",
        },
      },
    }

    expect(mockResponse.copilot_plan).toBe("copilot_business")
    expect(Object.keys(mockResponse.quota_snapshots).length).toBe(2)
    expect(mockResponse.quota_snapshots.completions?.quota_breakdown).toBe("completions")
  })
})
