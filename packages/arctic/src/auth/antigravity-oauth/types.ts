import type { HeaderStyle } from "./constants";

/**
 * Model family type for quota tracking
 */
export type ModelFamily = "claude" | "gemini";

/**
 * Quota key combining family and header style
 */
export type QuotaKey = "claude" | "gemini-antigravity" | "gemini-cli";

/**
 * Re-export HeaderStyle from constants
 */
export type { HeaderStyle };

/**
 * Parsed refresh token parts
 */
export interface RefreshParts {
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
}

/**
 * OAuth authentication details (matches Arctic's Auth.Oauth format)
 */
export interface OAuthAuthDetails {
  type: "oauth";
  refresh: string;
  access?: string;
  expires?: number;
}

/**
 * API key authentication details
 */
export interface ApiKeyAuthDetails {
  type: "api";
  key: string;
}

/**
 * Non-OAuth authentication details
 */
export interface NonOAuthAuthDetails {
  type: string;
  [key: string]: unknown;
}

/**
 * Union of all auth detail types
 */
export type AuthDetails = OAuthAuthDetails | ApiKeyAuthDetails | NonOAuthAuthDetails;

/**
 * Rate limit state for v3 storage (per quota pool)
 */
export interface RateLimitStateV3 {
  claude?: number;
  "gemini-antigravity"?: number;
  "gemini-cli"?: number;
}

/**
 * Account metadata for v3 storage
 */
export interface AccountMetadataV3 {
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
  rateLimitResetTimes?: RateLimitStateV3;
}

/**
 * Account storage v3 format with per-family active index
 */
export interface AccountStorageV3 {
  version: 3;
  accounts: AccountMetadataV3[];
  activeIndex: number;
  activeIndexByFamily?: {
    claude?: number;
    gemini?: number;
  };
}

/**
 * Rate limit state for v2 storage (legacy)
 */
export interface RateLimitState {
  claude?: number;
  gemini?: number;
}

/**
 * Account metadata for v2 storage (legacy)
 */
export interface AccountMetadata {
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
  rateLimitResetTimes?: RateLimitState;
}

/**
 * Account storage v2 format (legacy)
 */
export interface AccountStorage {
  version: 2;
  accounts: AccountMetadata[];
  activeIndex: number;
}

/**
 * Account metadata for v1 storage (legacy)
 */
export interface AccountMetadataV1 {
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  isRateLimited?: boolean;
  rateLimitResetTime?: number;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
}

/**
 * Account storage v1 format (legacy)
 */
export interface AccountStorageV1 {
  version: 1;
  accounts: AccountMetadataV1[];
  activeIndex: number;
}

/**
 * Union of all account storage versions
 */
export type AnyAccountStorage = AccountStorageV1 | AccountStorage | AccountStorageV3;

/**
 * Managed account with runtime state
 */
export interface ManagedAccount {
  index: number;
  email?: string;
  addedAt: number;
  lastUsed: number;
  parts: RefreshParts;
  access?: string;
  expires?: number;
  rateLimitResetTimes: RateLimitStateV3;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
}

/**
 * Project context resolution result
 */
export interface ProjectContextResult {
  auth: OAuthAuthDetails;
  effectiveProjectId: string;
}

/**
 * Antigravity authorization result
 */
export interface AntigravityAuthorization {
  url: string;
  verifier: string;
  projectId?: string;
}

/**
 * Antigravity token exchange success result
 */
export interface AntigravityTokenExchangeSuccess {
  type: "success";
  refresh: string;
  access: string;
  expires: number;
  email?: string;
  projectId?: string;
}

/**
 * Antigravity token exchange failure result
 */
export interface AntigravityTokenExchangeFailed {
  type: "failed";
  error: string;
}

/**
 * Antigravity token exchange result
 */
export type AntigravityTokenExchangeResult =
  | AntigravityTokenExchangeSuccess
  | AntigravityTokenExchangeFailed;

/**
 * Antigravity OAuth state parameters
 */
export interface AntigravityOAuthState {
  verifier: string;
  projectId?: string;
}
