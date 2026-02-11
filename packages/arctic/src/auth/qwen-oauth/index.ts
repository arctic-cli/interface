import type { Plugin, PluginInput } from "@arctic-cli/plugin"
import { openBrowserUrl } from "../codex-oauth/auth/browser"
import { Auth } from "../index"
import { ensureAuth, getApiBaseUrl, pollForToken, requestDeviceCode } from "./auth"
import { UI } from "@/cli/ui"

export { ensureAuth, getApiBaseUrl } from "./auth"

export const ArcticQwenAuth: Plugin = async (_: PluginInput) => {
  return {
    auth: {
      provider: "alibaba",

      async loader(getAuth: () => Promise<Auth.Info>) {
        const auth = await getAuth()

        if (auth?.type !== "alibaba") {
          return {}
        }

        const accessToken = await ensureAuth(auth)

        if (!accessToken) {
          return {}
        }

        return {
          apiKey: accessToken,
          baseURL: getApiBaseUrl(auth.enterpriseUrl),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-DashScope-AuthType": "qwen_oauth",
          },
        }
      },

      methods: [
        {
          label: "Qwen Account (OAuth)",
          type: "oauth" as const,
          async authorize() {
            const result = await requestDeviceCode()

            if (!result) {
              throw new Error("Failed to request device code")
            }

            const url = result.deviceCode.verification_uri_complete || result.deviceCode.verification_uri

            const interval = result.deviceCode.interval ?? 2
            let pollInterval = interval * 1000

            return {
              url,
              instructions: `Click 'Open Link' to visit the URL in your browser and authorize.\n\nURL: ${UI.hyperlink(url)}`,
              method: "auto" as const,
              async callback() {
                while (true) {
                  const pollResult = await pollForToken(result.deviceCode.device_code, result.verifier, interval)

                  if (pollResult.type === "success") {
                    await Auth.set("alibaba", {
                      type: "alibaba",
                      access: pollResult.access,
                      refresh: pollResult.refresh,
                      expires: pollResult.expires,
                      enterpriseUrl: pollResult.resourceUrl,
                    })
                    return pollResult
                  }

                  if (pollResult.type === "pending") {
                    await new Promise((resolve) => setTimeout(resolve, pollInterval))
                    continue
                  }

                  if (pollResult.type === "slow_down") {
                    pollInterval = Math.min(pollInterval * 1.5, 10000)
                    await new Promise((resolve) => setTimeout(resolve, pollInterval))
                    continue
                  }

                  if (pollResult.type === "expired") {
                    return { type: "failed" as const, error: "Authorization expired" }
                  }

                  if (pollResult.type === "denied") {
                    return { type: "failed" as const, error: "Authorization denied" }
                  }

                  return {
                    type: "failed" as const,
                    error: "Authorization failed - please check log file for details",
                  }
                }
              },
            }
          },
        },
      ],
    },
  }
}

export default ArcticQwenAuth
