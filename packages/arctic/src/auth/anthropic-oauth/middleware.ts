import { Auth } from "@/auth"
import { isTokenExpired, refreshAccessToken } from "./token"

export async function ensureAnthropicTokenValid(): Promise<void> {
  const auth = await Auth.get("anthropic")
  if (auth?.type !== "oauth") return

  // check if token is expired or about to expire (within 5 minutes)
  if (!auth.access || isTokenExpired(auth.expires)) {
    const result = await refreshAccessToken(auth.refresh)
    if (result.type === "success" && result.access) {
      await Auth.set("anthropic", {
        type: "oauth",
        access: result.access,
        refresh: result.refresh ?? auth.refresh,
        expires: result.expires ?? Date.now() + 3600 * 1000,
      })
    }
  }
}
