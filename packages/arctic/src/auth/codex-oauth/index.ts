/**
 * OpenAI ChatGPT (Codex) OAuth Authentication Plugin for opencode
 *
 * COMPLIANCE NOTICE:
 * This plugin uses OpenAI's official OAuth authentication flow (the same method
 * used by OpenAI's official Codex CLI at https://github.com/openai/codex).
 *
 * INTENDED USE: Personal development and coding assistance with your own
 * ChatGPT Plus/Pro subscription.
 *
 * NOT INTENDED FOR: Commercial resale, multi-user services, high-volume
 * automated extraction, or any use that violates OpenAI's Terms of Service.
 *
 * Users are responsible for ensuring their usage complies with:
 * - OpenAI Terms of Use: https://openai.com/policies/terms-of-use/
 * - OpenAI Usage Policies: https://openai.com/policies/usage-policies/
 *
 * For production applications, use the OpenAI Platform API: https://platform.openai.com/
 *
 * @license MIT with Usage Disclaimer (see LICENSE file)
 * @author numman-ali
 * @repository https://github.com/numman-ali/opencode-openai-codex-auth
 */

import type { Plugin, PluginInput } from "@arctic-ai/plugin";
import { Auth } from "../index";
import {
	createAuthorizationFlow,
	decodeJWT,
	exchangeAuthorizationCode,
	REDIRECT_URI,
} from "./auth/auth";
import { openBrowserUrl } from "./auth/browser";
import { startLocalOAuthServer } from "./auth/server";
import { getCodexMode, loadPluginConfig } from "./config";
import {
	AUTH_LABELS,
	CODEX_BASE_URL,
	DUMMY_API_KEY,
	ERROR_MESSAGES,
	JWT_CLAIM_PATH,
	LOG_STAGES,
	OPENAI_HEADER_VALUES,
	OPENAI_HEADERS,
	PLUGIN_NAME,
	PROVIDER_ID,
} from "./constants";
import { logRequest } from "./logger";
import {
	createCodexHeaders,
	extractRequestUrl,
	handleErrorResponse,
	handleSuccessResponse,
	refreshAndUpdateToken,
	rewriteUrlForCodex,
	shouldRefreshToken,
	transformRequestForCodex,
} from "./request/fetch-helpers";
import type { UserConfig } from "./types";

/**
 * OpenAI Codex OAuth authentication plugin for opencode
 *
 * This plugin enables opencode to use OpenAI's Codex backend via ChatGPT Plus/Pro
 * OAuth authentication, allowing users to leverage their ChatGPT subscription
 * instead of OpenAI Platform API credits.
 *
 * @example
 * ```json
 * {
 *   "plugin": ["opencode-openai-codex-auth"],
 *   "model": "openai/gpt-5-codex"
 * }
 * ```
 */
export const ArcticCodexAuth: Plugin = async ({ client }: PluginInput) => {
	return {
		auth: {
			provider: PROVIDER_ID,
			/**
			 * Loader function that configures OAuth authentication and request handling
			 *
			 * This function:
			 * 1. Validates OAuth authentication
			 * 2. Extracts ChatGPT account ID from access token
			 * 3. Loads user configuration from opencode.json
			 * 4. Fetches Codex system instructions from GitHub (cached)
			 * 5. Returns SDK configuration with custom fetch implementation
			 *
			 * @param getAuth - Function to retrieve current auth state
			 * @param provider - Provider configuration from opencode.json
			 * @returns SDK configuration object or empty object for non-OAuth auth
			 */
			async loader(getAuth: () => Promise<Auth.Info>, provider: unknown) {
				const auth = await getAuth();

				// Support both standard oauth and internal codex auth types
				if (auth.type !== "oauth" && auth.type !== "codex") {
					return {};
				}

				// Normalize token access (codex uses accessToken, oauth uses access)
				const accessToken = (auth as any).accessToken ?? (auth as any).access;

				// Extract ChatGPT account ID from JWT access token
				const decoded = decodeJWT(accessToken);
				const accountId = decoded?.[JWT_CLAIM_PATH]?.chatgpt_account_id;

                if (!accountId) {
                    console.error(`[${PLUGIN_NAME}] ${ERROR_MESSAGES.NO_ACCOUNT_ID}`);
                    return {};
                }
				// Extract user configuration (global + per-model options)
				const providerConfig = provider as
					| { options?: Record<string, unknown>; models?: UserConfig["models"] }
					| undefined;
				const userConfig: UserConfig = {
					global: providerConfig?.options || {},
					models: providerConfig?.models || {},
				};

				// Load plugin configuration and determine CODEX_MODE
				// Priority: CODEX_MODE env var > config file > default (true)
				const pluginConfig = loadPluginConfig();
				const codexMode = getCodexMode(pluginConfig);

				// Return SDK configuration
				return {
					apiKey: DUMMY_API_KEY,
					baseURL: CODEX_BASE_URL,
					/**
					 * Custom fetch implementation for Codex API
					 *
					 * Handles:
					 * - Token refresh when expired
					 * - URL rewriting for Codex backend
					 * - Request body transformation
					 * - OAuth header injection
					 * - SSE to JSON conversion for non-tool requests
					 * - Error handling and logging
					 *
					 * @param input - Request URL or Request object
					 * @param init - Request options
					 * @returns Response from Codex API
					 */
					async fetch(
						input: Request | string | URL,
						init?: RequestInit,
					): Promise<Response> {
						// Step 1: Check and refresh token if needed
						const currentAuth = await getAuth();
						if (shouldRefreshToken(currentAuth)) {
							const refreshResult = await refreshAndUpdateToken(
								currentAuth,
								client,
							);
							if (!refreshResult.success) {
								return refreshResult.response;
							}
						}

						// Step 2: Extract and rewrite URL for Codex backend
						const originalUrl = extractRequestUrl(input);
						const url = rewriteUrlForCodex(originalUrl);
						// Step 3: Transform request body with model-specific Codex instructions
						// Instructions are fetched per model family (codex-max, codex, gpt-5.1)
						// Capture original stream value before transformation
						// generateText() sends no stream field, streamText() sends stream=true
						const originalBody = init?.body ? JSON.parse(init.body as string) : {};
						const isStreaming = originalBody.stream === true;

						const transformation = await transformRequestForCodex(
							init,
							url,
							userConfig,
							codexMode,
						);
						const requestInit = transformation?.updatedInit ?? init;

						// Step 4: Create headers with OAuth and ChatGPT account info
						const accessToken = (currentAuth as any).accessToken ?? (currentAuth as any).access ?? "";
						const headers = createCodexHeaders(
							requestInit,
							accountId,
							accessToken,
							{
								model: transformation?.body.model,
								promptCacheKey: (transformation?.body as any)?.prompt_cache_key,
							},
						);

						// Step 5: Make request to Codex API
						let response = await fetch(url, {
							...requestInit,
							headers,
						});

						// Check for 401 or token_invalidated error
						let shouldRetry = response.status === 401;
						if (!shouldRetry && !response.ok) {
							try {
								const clone = response.clone();
								const text = await clone.text();
								const data = JSON.parse(text);
								// Check for token_invalidated in various error structures
								const code = data?.detail?.error?.code ?? data?.error?.code;
								if (code === "token_invalidated") {
									shouldRetry = true;
								}
							} catch (e) {
								// Ignore JSON parse errors
							}
						}

						// Handle Unauthorized or Invalidated Token by refreshing and retrying once
						if (shouldRetry) {
							console.log(`[${PLUGIN_NAME}] Received 401 or token_invalidated, attempting token refresh...`);
							const refreshResult = await refreshAndUpdateToken(
								currentAuth,
								client,
							);

							if (refreshResult.success) {
								const newAccessToken = (refreshResult.auth as any).accessToken ?? (refreshResult.auth as any).access ?? "";
								
								// Re-create headers with new token
								const newHeaders = createCodexHeaders(
									requestInit,
									accountId,
									newAccessToken,
									{
										model: transformation?.body.model,
										promptCacheKey: (transformation?.body as any)?.prompt_cache_key,
									},
								);

								// Retry request
								response = await fetch(url, {
									...requestInit,
									headers: newHeaders,
								});
							} else {
								console.error(`[${PLUGIN_NAME}] Token refresh failed during recovery.`);
							}
						}

						// Step 6: Log response
						logRequest(LOG_STAGES.RESPONSE, {
							status: response.status,
							ok: response.ok,
							statusText: response.statusText,
							headers: Object.fromEntries(response.headers.entries()),
						});

						// Step 7: Handle error or success response
						if (!response.ok) {
							return await handleErrorResponse(response);
						}

						return await handleSuccessResponse(response, isStreaming);
					},
				};
			},
			methods: [
				{
					label: AUTH_LABELS.OAUTH,
					type: "oauth" as const,
					/**
					 * OAuth authorization flow
					 *
					 * Steps:
					 * 1. Generate PKCE challenge and state for security
					 * 2. Start local OAuth callback server on port 1455
					 * 3. Open browser to OpenAI authorization page
					 * 4. Wait for user to complete login
					 * 5. Exchange authorization code for tokens
					 *
					 * @returns Authorization flow configuration
					 */
					authorize: async () => {
						const { pkce, state, url } = await createAuthorizationFlow();
						const serverInfo = await startLocalOAuthServer({ state });

						// Attempt to open browser automatically
						openBrowserUrl(url);

						return {
							url,
							method: "auto" as const,
							instructions: AUTH_LABELS.INSTRUCTIONS,
							callback: async () => {
								const result = await serverInfo.waitForCode(state);
								serverInfo.close();

								if (!result) {
									return { type: "failed" as const };
								}

								const tokens = await exchangeAuthorizationCode(
									result.code,
									pkce.verifier,
									REDIRECT_URI,
								);

								return tokens?.type === "success"
									? tokens
									: { type: "failed" as const };
							},
						};
					},
				},
				{
					label: AUTH_LABELS.API_KEY,
					type: "api" as const,
				},
			],
		},
	};
};

export default ArcticCodexAuth;
