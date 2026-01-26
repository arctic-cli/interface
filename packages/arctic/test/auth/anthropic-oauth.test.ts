import { test, expect, describe } from "bun:test"
import { ensureAnthropicTokenValid } from "@/auth/anthropic-oauth"
import { Auth } from "@/auth"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "@/project/instance"

describe("anthropic oauth middleware", () => {
	test("ensureAnthropicTokenValid does not throw when no auth", async () => {
		await using tmp = await tmpdir()
		await Instance.provide({
			directory: tmp.path,
			fn: async () => {
				await expect(ensureAnthropicTokenValid()).resolves.toBeUndefined()
			},
		})
	})

	test("ensureAnthropicTokenValid does not throw with api key auth", async () => {
		await using tmp = await tmpdir()
		await Instance.provide({
			directory: tmp.path,
			fn: async () => {
				await Auth.set("anthropic", { type: "api", key: "test-key" })
				await expect(ensureAnthropicTokenValid()).resolves.toBeUndefined()
			},
		})
	})

	test("ensureAnthropicTokenValid handles oauth with valid token", async () => {
		await using tmp = await tmpdir()
		await Instance.provide({
			directory: tmp.path,
			fn: async () => {
				await Auth.set("anthropic", {
					type: "oauth",
					access: "test-access-token",
					refresh: "test-refresh-token",
					expires: Date.now() + 3600 * 1000, // valid for 1 hour
				})
				await expect(ensureAnthropicTokenValid()).resolves.toBeUndefined()
			},
		})
	})
})
