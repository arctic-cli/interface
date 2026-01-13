import { test, expect, describe } from "bun:test"
import { Auth } from "@/auth"

describe("Auth connection utilities", () => {
  describe("parseKey", () => {
    test("parses provider without connection", () => {
      const result = Auth.parseKey("codex")
      expect(result).toEqual({ provider: "codex" })
    })

    test("parses provider with connection", () => {
      const result = Auth.parseKey("codex:work")
      expect(result).toEqual({ provider: "codex", connection: "work" })
    })

    test("handles connection names with multiple colons", () => {
      const result = Auth.parseKey("codex:work:prod")
      expect(result).toEqual({ provider: "codex", connection: "work:prod" })
    })
  })

  describe("formatKey", () => {
    test("formats provider without connection", () => {
      const result = Auth.formatKey("codex")
      expect(result).toBe("codex")
    })

    test("formats provider with connection", () => {
      const result = Auth.formatKey("codex", "work")
      expect(result).toBe("codex:work")
    })

    test("handles undefined connection", () => {
      const result = Auth.formatKey("codex", undefined)
      expect(result).toBe("codex")
    })
  })

  describe("formatDisplayName", () => {
    test("formats provider without connection", () => {
      const result = Auth.formatDisplayName("codex")
      expect(result).toBe("codex")
    })

    test("formats provider with connection", () => {
      const result = Auth.formatDisplayName("codex", "work")
      expect(result).toBe("codex (work)")
    })

    test("handles undefined connection", () => {
      const result = Auth.formatDisplayName("codex", undefined)
      expect(result).toBe("codex")
    })
  })

  describe("parseDisplayName", () => {
    test("parses provider without connection", () => {
      const result = Auth.parseDisplayName("codex")
      expect(result).toEqual({ provider: "codex" })
    })

    test("parses provider with connection", () => {
      const result = Auth.parseDisplayName("codex (work)")
      expect(result).toEqual({ provider: "codex", connection: "work" })
    })

    test("handles connection names with spaces", () => {
      const result = Auth.parseDisplayName("codex (my company)")
      expect(result).toEqual({ provider: "codex", connection: "my company" })
    })

    test("handles provider names with spaces", () => {
      const result = Auth.parseDisplayName("GitHub Copilot (work)")
      expect(result).toEqual({ provider: "GitHub Copilot", connection: "work" })
    })
  })

  describe("validateConnectionName", () => {
    test("accepts valid names", () => {
      expect(Auth.validateConnectionName("work")).toBeUndefined()
      expect(Auth.validateConnectionName("my-company")).toBeUndefined()
      expect(Auth.validateConnectionName("client_123")).toBeUndefined()
      expect(Auth.validateConnectionName("ABC123")).toBeUndefined()
    })

    test("rejects empty names", () => {
      expect(Auth.validateConnectionName("")).toBeDefined()
    })

    test("rejects names that are too long", () => {
      const longName = "a".repeat(33)
      expect(Auth.validateConnectionName(longName)).toBeDefined()
    })

    test("rejects names with invalid characters", () => {
      expect(Auth.validateConnectionName("my company")).toBeDefined()
      expect(Auth.validateConnectionName("work@home")).toBeDefined()
      expect(Auth.validateConnectionName("client.acme")).toBeDefined()
    })
  })

  describe("suggestConnectionName", () => {
    test("suggests name from codex email", () => {
      const info: Auth.Info = {
        type: "codex",
        accessToken: "token",
        refreshToken: "refresh",
        idToken: "id",
        expiresAt: Date.now(),
        email: "user@company.com",
      }
      const result = Auth.suggestConnectionName(info)
      expect(result).toBe("company")
    })

    test("handles email without domain", () => {
      const info: Auth.Info = {
        type: "codex",
        accessToken: "token",
        refreshToken: "refresh",
        idToken: "id",
        expiresAt: Date.now(),
        email: "user",
      }
      const result = Auth.suggestConnectionName(info)
      expect(result).toBeUndefined()
    })

    test("returns undefined for non-email auth types", () => {
      const info: Auth.Info = {
        type: "api",
        key: "sk-123",
      }
      const result = Auth.suggestConnectionName(info)
      expect(result).toBeUndefined()
    })
  })
})
