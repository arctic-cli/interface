/**
 * Anthropic OAuth Token Refresh Implementation
 * Based on Yuyz0112/claude-code-reverse repository
 */

// Anthropic OAuth Configuration
const ANTHROPIC_OAUTH_CONFIG = {
	TOKEN_URL: "https://console.anthropic.com/v1/oauth/token",
	CLIENT_ID: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
}

export interface TokenResponse {
	access_token: string
	refresh_token?: string
	expires_in?: number
	token_type: string
}

export interface TokenResult {
	type: "success" | "failed"
	access?: string
	refresh?: string
	expires?: number
}

/**
 * Refresh access token using refresh token
 * @param refreshToken - The refresh token
 * @returns Token result with new access token, refresh token, and expiry
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResult> {
	try {
		const response = await globalThis.fetch(ANTHROPIC_OAUTH_CONFIG.TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: ANTHROPIC_OAUTH_CONFIG.CLIENT_ID,
			}),
		})

		if (!response.ok) {
			const text = await response.text().catch(() => "")
			console.error("[arctic-anthropic-oauth] Token refresh failed:", response.status, text)
			return { type: "failed" }
		}

		const json = (await response.json()) as TokenResponse

		if (!json?.access_token) {
			console.error("[arctic-anthropic-oauth] Token refresh response missing access_token:", json)
			return { type: "failed" }
		}

		// Calculate expiry time (default to 1 hour if not provided)
		const expiresIn = json.expires_in ?? 3600
		const expires = Date.now() + expiresIn * 1000

		return {
			type: "success",
			access: json.access_token,
			refresh: json.refresh_token ?? refreshToken, // Preserve old refresh token if new one not provided
			expires,
		}
	} catch (error) {
		console.error("[arctic-anthropic-oauth] Token refresh error:", error)
		return { type: "failed" }
	}
}

/**
 * Check if token is expired or about to expire
 * @param expiryTimestamp - Token expiry timestamp in milliseconds
 * @param bufferMs - Buffer time in milliseconds (default 5 minutes)
 * @returns True if token is expired or about to expire
 */
export function isTokenExpired(expiryTimestamp: number, bufferMs = 5 * 60 * 1000): boolean {
	return expiryTimestamp <= Date.now() + bufferMs
}
