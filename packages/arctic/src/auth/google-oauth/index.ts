/**
 * Google (Gemini) OAuth Authentication Plugin for arctic
 *
 * Uses Google's OAuth2 flow with pre-configured client credentials
 * from the Gemini CLI project.
 *
 * @license MIT
 */

import type { Plugin, PluginInput } from "@arctic-ai/plugin"
import { Auth } from "../index"
import { OAuth2Client } from "google-auth-library"
import http from "http"
import crypto from "crypto"
import open from "open"

const PROVIDER_ID = "google"
const AUTH_LABELS = {
  OAUTH: "Login with Google",
  API_KEY: "Use API Key",
  INSTRUCTIONS: "Complete the authorization in your browser. The browser will open automatically.",
}

// OAuth Configuration from Gemini CLI
const OAUTH_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const OAUTH_CLIENT_SECRET = "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"
const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]

const REDIRECT_URI_SUCCESS = "https://developers.google.com/gemini-code-assist/auth_success_gemini"
const REDIRECT_URI_FAILURE = "https://developers.google.com/gemini-code-assist/auth_failure_gemini"

/**
 * Get an available port for the callback server
 */
async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.listen(0, () => {
      const port = (server.address() as any).port
      server.close(() => resolve(port))
    })
    server.on("error", reject)
  })
}

/**
 * Perform OAuth authentication with browser flow
 */
async function authenticateWithGoogle(): Promise<{ accessToken: string; refreshToken: string; expiryDate: number }> {
  const port = await getAvailablePort()
  const redirectUri = `http://localhost:${port}/oauth2callback`
  const state = crypto.randomBytes(32).toString("hex")

  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
  })

  // Generate authorization URL
  const authUrl = client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: "offline",
    scope: OAUTH_SCOPES,
    state,
  })

  console.log("[Google OAuth] Opening browser for authentication...")
  console.log("[Google OAuth] If browser does not open, visit this URL:")
  console.log(authUrl)

  // Open browser
  await open(authUrl)

  // Start callback server
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url?.includes("/oauth2callback")) {
          res.writeHead(404)
          res.end()
          return
        }

        const url = new URL(req.url, `http://localhost:${port}`)
        const code = url.searchParams.get("code")
        const returnedState = url.searchParams.get("state")
        const error = url.searchParams.get("error")

        if (error) {
          res.writeHead(302, { Location: REDIRECT_URI_FAILURE })
          res.end()
          server.close()
          reject(new Error(`OAuth error: ${error}`))
          return
        }

        if (!code || returnedState !== state) {
          res.writeHead(302, { Location: REDIRECT_URI_FAILURE })
          res.end()
          server.close()
          reject(new Error("Invalid OAuth callback"))
          return
        }

        // Exchange code for tokens
        const { tokens } = await client.getToken({
          code,
          redirect_uri: redirectUri,
        })

        if (!tokens.access_token || !tokens.refresh_token) {
          res.writeHead(302, { Location: REDIRECT_URI_FAILURE })
          res.end()
          server.close()
          reject(new Error("No access token or refresh token received"))
          return
        }

        // Redirect to success page
        res.writeHead(302, { Location: REDIRECT_URI_SUCCESS })
        res.end()

        server.close()
        console.log("[Google OAuth] Authentication successful!")

        resolve({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiryDate: tokens.expiry_date || Date.now() + 3600 * 1000,
        })
      } catch (err) {
        res.writeHead(302, { Location: REDIRECT_URI_FAILURE })
        res.end()
        server.close()
        reject(err)
      }
    })

    server.listen(port, "localhost")
    console.log(`[Google OAuth] Callback server listening on http://localhost:${port}`)
  })
}

/**
 * Google OAuth authentication plugin for arctic
 */
export const ArcticGoogleAuth: Plugin = async ({ client }: PluginInput) => {
  return {
    auth: {
      provider: PROVIDER_ID,
      /**
       * Loader function that configures OAuth or API key authentication
       */
      async loader(getAuth: () => Promise<Auth.Info>, provider: unknown) {
        const auth = await getAuth()

        // For API key authentication (existing behavior)
        if (auth.type === "api") {
          return {
            apiKey: auth.key,
          }
        }

        // For OAuth authentication
        if (auth.type === "oauth") {
          // Use the access token as the API key
          return {
            apiKey: auth.access,
          }
        }

        return {}
      },
      methods: [
        {
          label: AUTH_LABELS.OAUTH,
          type: "oauth" as const,
          /**
           * OAuth authorization flow
           */
          authorize: async () => {
            return {
              url: "https://accounts.google.com/o/oauth2/auth", // Placeholder
              method: "auto" as const,
              instructions: AUTH_LABELS.INSTRUCTIONS,
              callback: async () => {
                try {
                  const { accessToken, refreshToken, expiryDate } = await authenticateWithGoogle()

                  return {
                    type: "success" as const,
                    access: accessToken,
                    refresh: refreshToken,
                    expires: expiryDate,
                  }
                } catch (error) {
                  console.error("[Google OAuth] Authentication failed:", error)
                  return { type: "failed" as const }
                }
              },
            }
          },
        },
        {
          label: AUTH_LABELS.API_KEY,
          type: "api" as const,
        },
      ],
    },
  }
}

export default ArcticGoogleAuth
