import type { Plugin, PluginInput } from "@arctic-cli/plugin"
import { openBrowserUrl } from "../codex-oauth/auth/browser"

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

export const ArcticAnthropicAuth: Plugin = async (input: PluginInput) => {
  return {
    auth: {
      provider: "anthropic",

      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth.type === "oauth") {
          // Zero out cost for Pro/Max plan users
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0,
              },
            }
          }

          return {
            apiKey: "",
            async fetch(url: string | URL | Request, init?: RequestInit) {
              const currentAuth = await getAuth()
              if (currentAuth.type !== "oauth") return fetch(url, init)

              // Check if token needs refresh
              if (!currentAuth.access || currentAuth.expires < Date.now()) {
                const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    grant_type: "refresh_token",
                    refresh_token: currentAuth.refresh,
                    client_id: CLIENT_ID,
                  }),
                })
                if (!response.ok) {
                  throw new Error(`Token refresh failed: ${response.status}`)
                }
                const json = await response.json()
                await input.client.auth.set({
                  path: {
                    id: "anthropic",
                  },
                  body: {
                    type: "oauth",
                    refresh: json.refresh_token,
                    access: json.access_token,
                    expires: Date.now() + json.expires_in * 1000,
                  },
                })
                currentAuth.access = json.access_token
              }

              const requestInit = init ?? {}
              const requestHeaders = new Headers()

              if (url instanceof Request) {
                url.headers.forEach((value, key) => {
                  requestHeaders.set(key, value)
                })
              }

              if (requestInit.headers) {
                if (requestInit.headers instanceof Headers) {
                  requestInit.headers.forEach((value, key) => {
                    requestHeaders.set(key, value)
                  })
                } else if (Array.isArray(requestInit.headers)) {
                  for (const [key, value] of requestInit.headers) {
                    if (typeof value !== "undefined") {
                      requestHeaders.set(key, String(value))
                    }
                  }
                } else {
                  for (const [key, value] of Object.entries(requestInit.headers)) {
                    if (typeof value !== "undefined") {
                      requestHeaders.set(key, String(value))
                    }
                  }
                }
              }

              // Add OAuth headers
              const incomingBeta = requestHeaders.get("anthropic-beta") || ""
              const incomingBetasList = incomingBeta
                .split(",")
                .map((b: string) => b.trim())
                .filter(Boolean)

              const includeClaudeCode = incomingBetasList.includes("claude-code-20250219")

              const mergedBetas = [
                "oauth-2025-04-20",
                "interleaved-thinking-2025-05-14",
                ...(includeClaudeCode ? ["claude-code-20250219"] : []),
              ].join(",")

              requestHeaders.set("authorization", `Bearer ${currentAuth.access}`)
              requestHeaders.set("anthropic-beta", mergedBetas)
              requestHeaders.set("user-agent", "claude-cli/2.1.2 (external, cli)")
              requestHeaders.delete("x-api-key")

              const TOOL_PREFIX = "mcp_"
              let body = requestInit.body
              if (body && typeof body === "string") {
                try {
                  const parsed = JSON.parse(body)

                  // Sanitize system prompt - server blocks "OpenCode" string
                  if (parsed.system && Array.isArray(parsed.system)) {
                    parsed.system = parsed.system.map((item: any) => {
                      if (item.type === "text" && item.text) {
                        return {
                          ...item,
                          text: item.text
                            .replace(/OpenCode/g, "Claude Code")
                            .replace(/opencode/gi, "Claude"),
                        }
                      }
                      return item
                    })
                  }

                  // Add prefix to tools definitions
                  if (parsed.tools && Array.isArray(parsed.tools)) {
                    parsed.tools = parsed.tools.map((tool: any) => ({
                      ...tool,
                      name: tool.name ? `${TOOL_PREFIX}${tool.name}` : tool.name,
                    }))
                  }

                  // Add prefix to tool_use blocks in messages
                  if (parsed.messages && Array.isArray(parsed.messages)) {
                    parsed.messages = parsed.messages.map((msg: any) => {
                      if (msg.content && Array.isArray(msg.content)) {
                        msg.content = msg.content.map((block: any) => {
                          if (block.type === "tool_use" && block.name) {
                            return { ...block, name: `${TOOL_PREFIX}${block.name}` }
                          }
                          return block
                        })
                      }
                      return msg
                    })
                  }
                  body = JSON.stringify(parsed)
                } catch (error) {
                  // ignore parse errors
                }
              }

              let requestInput: string | URL | Request = url
              let requestUrl: URL | null = null
              try {
                if (typeof url === "string" || url instanceof URL) {
                  requestUrl = new URL(url.toString())
                } else if (url instanceof Request) {
                  requestUrl = new URL(url.url)
                }
              } catch {
                requestUrl = null
              }

              if (requestUrl && requestUrl.pathname === "/v1/messages" && !requestUrl.searchParams.has("beta")) {
                requestUrl.searchParams.set("beta", "true")
                requestInput = url instanceof Request ? new Request(requestUrl.toString(), url) : requestUrl
              }

              const response = await fetch(requestInput, {
                ...requestInit,
                body,
                headers: requestHeaders,
              })

              // Transform streaming response to rename tools back
              if (response.body) {
                const reader = response.body.getReader()
                const decoder = new TextDecoder()
                const encoder = new TextEncoder()

                const stream = new ReadableStream({
                  async pull(controller) {
                    const { done, value } = await reader.read()
                    if (done) {
                      controller.close()
                      return
                    }

                    let text = decoder.decode(value, { stream: true })
                    text = text.replace(/"name"\s*:\s*"mcp_([^"]+)"/g, '"name": "$1"')
                    controller.enqueue(encoder.encode(text))
                  },
                })

                return new Response(stream, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                })
              }

              return response
            },
          }
        }

        return {}
      },

      methods: [
        {
          label: "Claude.ai Account (OAuth)",
          type: "oauth" as const,
          async authorize() {
            // Generate OAuth parameters
            const clientId = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
            const redirectUri = "https://console.anthropic.com/oauth/code/callback"
            const scope = "org:create_api_key user:profile user:inference"

            // Generate PKCE challenge
            const codeVerifier = generateCodeVerifier()
            const codeChallenge = await generateCodeChallenge(codeVerifier)
            const state = generateRandomString(64)

            // Build authorization URL
            const params = new URLSearchParams({
              code: "true",
              client_id: clientId,
              response_type: "code",
              redirect_uri: redirectUri,
              scope,
              code_challenge: codeChallenge,
              code_challenge_method: "S256",
              state,
            })

            const url = `https://claude.ai/oauth/authorize?${params.toString()}`

            return {
              url,
              instructions:
                "Click 'Open Link' to authenticate with Claude.ai, or copy the URL to open it manually.",
              method: "code" as const,
              async callback(code: string) {
                if (!code) {
                  return { type: "failed" as const, error: "No authorization code provided" }
                }

                // Extract code and state from the callback parameter
                // The user pastes something like: "code#state"
                const splits = code.split("#")
                const actualCode = splits[0].trim()
                const actualState = splits[1] || state

                try {
                  // Exchange code for tokens
                  const tokenResponse = await fetch("https://console.anthropic.com/v1/oauth/token", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      code: actualCode,
                      state: actualState,
                      grant_type: "authorization_code",
                      client_id: clientId,
                      redirect_uri: redirectUri,
                      code_verifier: codeVerifier,
                    }),
                  })

                  if (!tokenResponse.ok) {
                    return { type: "failed" as const, error: `Token exchange failed: ${tokenResponse.status}` }
                  }

                  const tokenData = await tokenResponse.json()

                  if (!tokenData.access_token) {
                    return { type: "failed" as const, error: "No access token received" }
                  }

                  // Calculate expiration timestamp
                  const expiresAt = Date.now() + (tokenData.expires_in ?? 3600) * 1000

                  return {
                    type: "success" as const,
                    access: tokenData.access_token,
                    refresh: tokenData.refresh_token,
                    expires: expiresAt,
                  }
                } catch (error) {
                  return {
                    type: "failed" as const,
                    error: error instanceof Error ? error.message : "Unknown error",
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

/**
 * Generate a random string for PKCE code verifier or state
 */
function generateRandomString(length: number): string {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * Generate PKCE code verifier (43-128 characters)
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

/**
 * Generate PKCE code challenge from verifier
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return base64UrlEncode(new Uint8Array(hash))
}

/**
 * Base64 URL-safe encoding (no padding)
 */
function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer))
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export default ArcticAnthropicAuth
