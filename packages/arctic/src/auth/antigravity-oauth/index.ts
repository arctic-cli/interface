/**
 * Antigravity OAuth Authentication Plugin for Arctic
 *
 * This plugin enables Arctic to use Google's Antigravity IDE backend via OAuth
 * authentication, providing access to both Claude and Gemini models through
 * a unified gateway with multi-account support and rate limiting.
 */

import type { Plugin, PluginInput } from "@arctic-ai/plugin"
import { openBrowserUrl } from "../codex-oauth/auth/browser"
import { Auth } from "../index"
import { AccountManager } from "./accounts"
import { isOAuthAuth } from "./auth-helpers"
import { ANTIGRAVITY_PROVIDER_ID } from "./constants"
import { getLogFilePath, isDebugEnabled, startAntigravityDebugRequest } from "./debug"
import { authorizeAntigravity, exchangeAntigravity } from "./oauth"
import { buildThinkingWarmupBody, prepareAntigravityRequest, transformAntigravityResponse } from "./request"
import { startLocalOAuthServer } from "./server"
import { ensureValidToken } from "./token"

/**
 * Antigravity OAuth authentication plugin for Arctic
 *
 * Provides:
 * - Google OAuth authentication with PKCE
 * - Multi-account support (up to 10 accounts)
 * - Intelligent account rotation with rate limiting
 * - Support for Claude and Gemini models
 * - Request/response transformation for Antigravity API
 */
export const ArcticAntigravityAuth: Plugin = async ({ client }: PluginInput) => {
  return {
    auth: {
      provider: ANTIGRAVITY_PROVIDER_ID,

      /**
       * Loader function that configures authentication and request handling
       *
       * This function:
       * 1. Validates OAuth authentication
       * 2. Loads multi-account manager from disk
       * 3. Sets up custom fetch with account rotation
       * 4. Handles token refresh automatically
       * 5. Transforms requests/responses for Antigravity API
       *
       * @param getAuth - Function to retrieve current auth state
       * @param provider - Provider configuration
       * @returns SDK configuration with custom fetch implementation
       */
      async loader(getAuth: () => Promise<Auth.Info>, provider: unknown) {
        const auth = await getAuth()

        // Only handle OAuth auth
        if (!isOAuthAuth(auth)) {
          return {}
        }

        // Load account manager with multi-account support
        const accountManager = await AccountManager.loadFromDisk(auth)

        if (accountManager.getAccountCount() === 0) {
          console.warn("[arctic-antigravity-auth] No accounts configured. Run 'arctic auth login'.")
          return {}
        }

        // Show debug log location if enabled
        if (isDebugEnabled()) {
          const logPath = getLogFilePath()
          if (logPath) {
            try {
              await client.tui.showToast({
                body: { message: `Antigravity debug log: ${logPath}`, variant: "info" },
              })
            } catch {
              // TUI may not be available
            }
          }
        }

        // Return SDK configuration with custom fetch
        return {
          apiKey: "", // Not used - OAuth handles auth
          /**
           * Custom fetch implementation for Antigravity API
           *
           * Handles:
           * - Multi-account rotation on rate limits
           * - Token refresh when expired
           * - Request transformation to Antigravity format
           * - Response transformation back to AI SDK format
           * - Endpoint fallback (daily → autopush → prod)
           * - Header style fallback for Gemini models
           *
           * @param input - Request URL or Request object
           * @param init - Request options
           * @returns Response from Antigravity API
           */
          async fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
            // Check if this is a request we should intercept
            const urlString = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
            if (!urlString.includes("generativelanguage.googleapis.com")) {
              return fetch(input, init)
            }

            // Get current auth (may have been updated)
            const latestAuth = await getAuth()
            if (!isOAuthAuth(latestAuth)) {
              return fetch(input, init)
            }

            if (accountManager.getAccountCount() === 0) {
              throw new Error("No Antigravity accounts configured")
            }

            // Simplified implementation - uses first account only
            const accounts = accountManager.getAccounts()
            const account = accounts[0]
            if (!account) {
              throw new Error("No accounts available")
            }

            // Ensure token is valid
            const accountAuth = accountManager.toAuthDetails(account)
            const validAuth = await ensureValidToken(accountAuth)
            accountManager.updateFromAuth(account, validAuth)

            // Get project ID
            const projectId = account.parts.projectId || account.parts.managedProjectId || ""

            try {
              const accessToken = validAuth.access
              if (!accessToken) {
                throw new Error("Missing Antigravity OAuth access token")
              }

              const prepared = prepareAntigravityRequest(input, init, accessToken, projectId)
              const originalUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
              const resolvedUrl =
                typeof prepared.request === "string"
                  ? prepared.request
                  : prepared.request instanceof URL
                    ? prepared.request.href
                    : prepared.request.url

              const debugContext = startAntigravityDebugRequest({
                originalUrl,
                resolvedUrl,
                method: prepared.init.method,
                headers: prepared.init.headers,
                body: prepared.init.body,
                streaming: prepared.streaming,
                projectId: prepared.projectId,
              })

              if (prepared.needsSignedThinkingWarmup && prepared.init.body) {
                const isClaudeThinking =
                  typeof prepared.effectiveModel === "string" &&
                  prepared.effectiveModel.toLowerCase().includes("claude") &&
                  prepared.effectiveModel.toLowerCase().includes("thinking")
                const warmupBody = buildThinkingWarmupBody(prepared.init.body as string, isClaudeThinking)
                if (warmupBody) {
                  const warmupInit = { ...prepared.init, body: warmupBody }
                  const warmupDebugContext = startAntigravityDebugRequest({
                    originalUrl,
                    resolvedUrl,
                    method: warmupInit.method,
                    headers: warmupInit.headers,
                    body: warmupInit.body,
                    streaming: prepared.streaming,
                    projectId: prepared.projectId,
                  })
                  const warmupResponse = await fetch(prepared.request, warmupInit)
                  await transformAntigravityResponse(
                    warmupResponse,
                    prepared.streaming,
                    warmupDebugContext,
                    prepared.requestedModel,
                    prepared.projectId,
                    prepared.endpoint,
                    prepared.effectiveModel,
                    prepared.sessionId,
                  )
                }
              }

              const response = await fetch(prepared.request, prepared.init)
              return await transformAntigravityResponse(
                response,
                prepared.streaming,
                debugContext,
                prepared.requestedModel,
                prepared.projectId,
                prepared.endpoint,
                prepared.effectiveModel,
                prepared.sessionId,
                prepared.toolDebugMissing,
                prepared.toolDebugSummary,
                prepared.toolDebugPayload,
              )
            } catch (error) {
              throw error
            }
          },
        }
      },

      /**
       * Authentication methods available for this provider
       */
      methods: [
        {
          label: "OAuth with Google (Antigravity)",
          type: "oauth" as const,
          async authorize() {
            // Generate authorization URL
            const { url, verifier, projectId } = await authorizeAntigravity()

            // Start local callback server
            const server = await startLocalOAuthServer()

            // Open browser to authorization URL
            try {
              openBrowserUrl(url)
            } catch (error) {
              console.warn("Failed to open browser automatically:", error)
            }

            return {
              url,
              instructions: `Opening browser to ${url}\n\nWaiting for authorization...`,
              method: "auto" as const,
              async callback() {
                try {
                  // Wait for OAuth callback
                  const result = await server.waitForCallback()

                  if (!result) {
                    return {
                      type: "failed" as const,
                      error: "Authorization timeout or server error",
                    }
                  }

                  // Exchange code for tokens
                  const exchangeResult = await exchangeAntigravity(result.code, result.state)

                  if (exchangeResult.type === "failed") {
                    return exchangeResult
                  }

                  // Store in Arctic auth format
                  const authInfo = {
                    type: "oauth" as const,
                    refresh: exchangeResult.refresh,
                    access: exchangeResult.access,
                    expires: exchangeResult.expires,
                  }

                  await Auth.set(ANTIGRAVITY_PROVIDER_ID, authInfo)

                  return exchangeResult
                } finally {
                  server.close()
                }
              },
            }
          },
        },
        {
          label: "API Key (not supported)",
          type: "api" as const,
        },
      ],
    },
  }
}

export default ArcticAntigravityAuth
