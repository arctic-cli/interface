import type { Plugin, PluginInput } from "@arctic-cli/plugin"
import crypto from "node:crypto"
import http from "node:http"
import { URL } from "node:url"
import { openBrowserUrl } from "../codex-oauth/auth/browser"
import { UI } from "@/cli/ui"

const AMP_DEFAULT_URL = "https://ampcode.com"
const CALLBACK_PATH = "/auth/callback"

function normalizeBaseUrl(raw?: string) {
  return (raw || AMP_DEFAULT_URL).replace(/\/$/, "")
}

async function findAvailablePort(start = 35789, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const port = start + i
    const ok = await new Promise<boolean>((resolve) => {
      const server = http.createServer()
      server.once("error", () => resolve(false))
      server.once("listening", () => {
        server.close(() => resolve(true))
      })
      server.listen(port, "127.0.0.1")
    })
    if (ok) return port
  }
  throw new Error("Could not find an available port for Amp login callback")
}

function startAmpAuthServer({ authToken, port }: { authToken: string; port: number }) {
  let resolveKey: (value: string | null) => void
  let rejectKey: (error: unknown) => void
  const keyPromise = new Promise<string | null>((resolve, reject) => {
    resolveKey = resolve
    rejectKey = reject
  })

  const server = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url || "", `http://127.0.0.1:${port}`)
      if (!reqUrl.pathname.startsWith(CALLBACK_PATH)) {
        res.writeHead(404, { "Content-Type": "text/plain" })
        res.end("Not found")
        return
      }

      const returnedAuthToken = reqUrl.searchParams.get("authToken")
      if (returnedAuthToken !== authToken) {
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("Invalid auth token")
        return
      }

      const apiKey = reqUrl.searchParams.get("accessToken") || reqUrl.searchParams.get("apiKey")
      if (!apiKey) {
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("Missing access token")
        return
      }

      res.writeHead(200, { "Content-Type": "text/html" })
      res.end("<html><body><h1>Login complete</h1><p>You can close this window.</p></body></html>")

      resolveKey(apiKey)
      server.close(() => {})
    } catch (err) {
      server.close(() => rejectKey(err))
    }
  })

  const listenPromise = new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve())
    server.on("error", (err) => {
      server.close(() => reject(err))
    })
  })

  return {
    listen: () => listenPromise,
    waitForKey: () => keyPromise,
    close: () => server.close(() => {}),
  }
}

export const ArcticAmpAuth: Plugin = async (_input: PluginInput) => {
  return {
    auth: {
      provider: "amp",
      methods: [
        {
          type: "oauth",
          label: "Login with Amp",
          async authorize() {
            const baseUrl = normalizeBaseUrl(process.env.AMP_URL)
            const authToken = crypto.randomBytes(32).toString("hex")
            const callbackPort = await findAvailablePort()
            const loginUrl = `${baseUrl}/auth/cli-login?authToken=${encodeURIComponent(
              authToken,
            )}&callbackPort=${encodeURIComponent(callbackPort)}`
            const manualUrl = `${baseUrl}/auth/cli-login?authToken=${encodeURIComponent(authToken)}`

            const server = startAmpAuthServer({ authToken, port: callbackPort })
            await server.listen()

            return {
              url: loginUrl,
              instructions: `Click 'Open Link' to authenticate, or if the callback fails, open ${UI.hyperlink(manualUrl, manualUrl)} and paste the access token.`,
              method: "auto",
              callback: async () => {
                try {
                  const key = await server.waitForKey()
                  server.close()
                  if (!key) return { type: "failed" }
                  return { type: "success", key }
                } catch {
                  server.close()
                  return { type: "failed" }
                }
              },
            }
          },
        },
        {
          type: "oauth",
          label: "Paste access token",
          async authorize() {
            const baseUrl = normalizeBaseUrl(process.env.AMP_URL)
            const authToken = crypto.randomBytes(32).toString("hex")
            const manualUrl = `${baseUrl}/auth/cli-login?authToken=${encodeURIComponent(authToken)}`

            return {
              url: manualUrl,
              instructions: "Click 'Open Link' to authenticate, complete login, then paste the access token here.",
              method: "code",
              callback: async (code: string) => {
                if (!code) return { type: "failed" }
                return { type: "success", key: code }
              },
            }
          },
        },
      ],
    },
  }
}
