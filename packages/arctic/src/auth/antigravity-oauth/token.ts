import { ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET, ANTIGRAVITY_PROVIDER_ID } from "./constants";
import { formatRefreshParts, parseRefreshParts } from "./auth-helpers";
import type { OAuthAuthDetails, RefreshParts } from "./types";
import { Auth } from "../index";

interface OAuthErrorPayload {
  error?:
    | string
    | {
        code?: string;
        status?: string;
        message?: string;
      };
  error_description?: string;
}

/**
 * Parses OAuth error payloads returned by Google token endpoints, tolerating varied shapes.
 */
function parseOAuthErrorPayload(text: string | undefined): { code?: string; description?: string } {
  if (!text) {
    return {};
  }

  try {
    const payload = JSON.parse(text) as OAuthErrorPayload;
    if (!payload || typeof payload !== "object") {
      return { description: text };
    }

    let code: string | undefined;
    if (typeof payload.error === "string") {
      code = payload.error;
    } else if (payload.error && typeof payload.error === "object") {
      code = payload.error.status ?? payload.error.code;
      if (!payload.error_description && payload.error.message) {
        return { code, description: payload.error.message };
      }
    }

    const description = payload.error_description;
    if (description) {
      return { code, description };
    }

    if (payload.error && typeof payload.error === "object" && payload.error.message) {
      return { code, description: payload.error.message };
    }

    return { code };
  } catch {
    return { description: text };
  }
}

export class AntigravityTokenRefreshError extends Error {
  code?: string;
  description?: string;
  status: number;
  statusText: string;

  constructor(options: {
    message: string;
    code?: string;
    description?: string;
    status: number;
    statusText: string;
  }) {
    super(options.message);
    this.name = "AntigravityTokenRefreshError";
    this.code = options.code;
    this.description = options.description;
    this.status = options.status;
    this.statusText = options.statusText;
  }
}

/**
 * Refreshes an Antigravity OAuth access token and returns updated auth details.
 * Does not persist to disk - caller should use Auth.set() to persist.
 */
export async function refreshAccessToken(
  auth: OAuthAuthDetails,
): Promise<OAuthAuthDetails | undefined> {
  const parts = parseRefreshParts(auth.refresh);
  if (!parts.refreshToken) {
    return undefined;
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: parts.refreshToken,
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
      }),
    });

    if (!response.ok) {
      let errorText: string | undefined;
      try {
        errorText = await response.text();
      } catch {
        errorText = undefined;
      }

      const { code, description } = parseOAuthErrorPayload(errorText);
      const details = [code, description ?? errorText].filter(Boolean).join(": ");
      const baseMessage = `Antigravity token refresh failed (${response.status} ${response.statusText})`;
      const message = details ? `${baseMessage} - ${details}` : baseMessage;
      console.warn(`[Antigravity OAuth] ${message}`);

      if (code === "invalid_grant") {
        console.warn(
          "[Antigravity OAuth] Google revoked the stored refresh token for this account. Reauthenticate via arctic auth.",
        );
      }

      throw new AntigravityTokenRefreshError({
        message,
        code,
        description: description ?? errorText,
        status: response.status,
        statusText: response.statusText,
      });
    }

    const payload = (await response.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    const refreshedParts: RefreshParts = {
      refreshToken: payload.refresh_token ?? parts.refreshToken,
      projectId: parts.projectId,
      managedProjectId: parts.managedProjectId,
    };

    const updatedAuth: OAuthAuthDetails = {
      ...auth,
      access: payload.access_token,
      expires: Date.now() + payload.expires_in * 1000,
      refresh: formatRefreshParts(refreshedParts),
    };

    return updatedAuth;
  } catch (error) {
    if (error instanceof AntigravityTokenRefreshError) {
      throw error;
    }
    console.error("Failed to refresh Antigravity access token due to an unexpected error:", error);
    return undefined;
  }
}

/**
 * Ensures the access token is valid, refreshing if necessary.
 * Persists updated auth to Arctic's storage.
 */
export async function ensureValidToken(auth: OAuthAuthDetails): Promise<OAuthAuthDetails> {
  const parts = parseRefreshParts(auth.refresh);
  if (!parts.refreshToken) {
    throw new Error("No refresh token available");
  }

  // Check if token needs refresh (5 min buffer)
  const needsRefresh = !auth.access || !auth.expires || auth.expires <= Date.now() + 5 * 60 * 1000;

  if (!needsRefresh) {
    return auth;
  }

  const refreshed = await refreshAccessToken(auth);
  if (!refreshed) {
    throw new Error("Failed to refresh access token");
  }

  // Persist updated auth to Arctic storage
  await Auth.set(ANTIGRAVITY_PROVIDER_ID, refreshed as Extract<Auth.Info, { type: "oauth" }>);

  return refreshed;
}
