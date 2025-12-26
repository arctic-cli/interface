import fs from "fs/promises"
import os from "os"
import path from "path"
import { Auth } from "./index"

export namespace CodexClient {
  const Config = {
    chatgptBaseUrl: "https://chatgpt.com/backend-api/",
    issuerBaseUrl: "https://auth.openai.com",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    scope: "openid profile email offline_access",
  }

  const DEVICE_LOGIN_URL = "https://auth.openai.com/codex/device"
  const DEVICE_AUTH_TIMEOUT_MS = 15 * 60 * 1000
  const CODEX_AUTH_FILENAME = "auth.json"

  interface DeviceCodeResponse {
    deviceAuthId: string
    userCode: string
    interval: number
    verificationUri: string
  }

  interface TokenResponse {
    access_token: string
    refresh_token: string
    id_token: string
    token_type?: string
    expires_in?: number
  }

  interface DeviceAuthTokenResponse {
    authorization_code: string
    code_challenge: string
    code_verifier: string
  }

  interface CodexCliAuthFile {
    OPENAI_API_KEY?: string
    tokens?: CodexCliTokenSet | null
  }

  interface CodexCliTokenSet {
    id_token?: string | { raw_jwt?: string }
    access_token?: string
    refresh_token?: string
    account_id?: string | null
  }

  export type ExistingCodexCredential =
    | {
        type: "codex"
        accessToken: string
        refreshToken: string
        idToken: string
        accountId?: string
        email?: string
        planType?: string
        expiresAt: number
      }
    | {
        type: "api"
        key: string
      }

  interface IdTokenInfo {
    email?: string
    chatgpt_plan_type?: string
    chatgpt_account_id?: string
  }

  function normalizeBaseUrl(input: string): string {
    let baseUrl = input
    while (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1)
    }
    if (
      (baseUrl.startsWith("https://chatgpt.com") || baseUrl.startsWith("https://chat.openai.com")) &&
      !baseUrl.includes("/backend-api")
    ) {
      baseUrl = `${baseUrl}/backend-api`
    }
    return baseUrl
  }

  function issuerPath(path: string): string {
    const base = Config.issuerBaseUrl.replace(/\/$/, "")
    return `${base}${path}`
  }

  function parseInterval(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
    if (typeof value === "string") {
      const parsed = parseInt(value.trim(), 10)
      if (!Number.isNaN(parsed)) {
        return parsed
      }
    }
    return 5
  }

  function resolveCodexHome(): string {
    const envPath = process.env.CODEX_HOME?.trim()
    if (envPath && envPath.length > 0) {
      return path.resolve(envPath)
    }
    return path.join(os.homedir(), ".codex")
  }

  async function readCodexAuthFile(): Promise<CodexCliAuthFile | null> {
    try {
      const filePath = path.join(resolveCodexHome(), CODEX_AUTH_FILENAME)
      const contents = await fs.readFile(filePath, "utf8")
      return JSON.parse(contents) as CodexCliAuthFile
    } catch {
      return null
    }
  }

  function extractIdToken(raw: CodexCliTokenSet["id_token"]): string | undefined {
    if (!raw) return undefined
    if (typeof raw === "string") return raw
    if (typeof raw === "object" && raw.raw_jwt) return raw.raw_jwt
    return undefined
  }

  export async function tryLoadExistingCredential(): Promise<ExistingCodexCredential | null> {
    const authFile = await readCodexAuthFile()
    if (!authFile) return null

    const tokens = authFile.tokens ?? undefined
    const idTokenString = extractIdToken(tokens?.id_token)
    if (tokens && idTokenString && tokens.access_token && tokens.refresh_token) {
      const idTokenInfo = parseIdToken(idTokenString)
      return {
        type: "codex",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: idTokenString,
        accountId: tokens.account_id ?? idTokenInfo?.chatgpt_account_id ?? undefined,
        email: idTokenInfo?.email,
        planType: idTokenInfo?.chatgpt_plan_type,
        // Force a refresh on the first API call so we don't operate on potentially stale tokens.
        expiresAt: Date.now() - 60 * 1000,
      }
    }

    if (authFile.OPENAI_API_KEY) {
      return {
        type: "api",
        key: authFile.OPENAI_API_KEY,
      }
    }

    return null
  }

  function parseIdToken(idToken: string): IdTokenInfo | null {
    try {
      const parts = idToken.split(".")
      if (parts.length !== 3) {
        return null
      }
      const [, payloadB64] = parts

      let base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/")
      while (base64.length % 4) {
        base64 += "="
      }

      let payloadBytes: string
      if (typeof atob !== "undefined") {
        payloadBytes = atob(base64)
      } else {
        payloadBytes = Buffer.from(base64, "base64").toString("utf-8")
      }

      const payload = JSON.parse(payloadBytes)
      const authClaims = payload["https://api.openai.com/auth"]
      return {
        email: payload.email,
        chatgpt_plan_type: authClaims?.chatgpt_plan_type,
        chatgpt_account_id: authClaims?.chatgpt_account_id,
      }
    } catch (error) {
      console.error("Failed to parse ID token:", error)
      return null
    }
  }

  export async function requestUserCode(): Promise<DeviceCodeResponse> {
    const response = await fetch(`${issuerPath("/api/accounts/deviceauth/usercode")}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: Config.clientId,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Failed to request user code: ${response.status} - ${text}`)
    }

    const body = await response.json()
    const deviceAuthId = body.device_auth_id
    const userCode = body.user_code
    if (!deviceAuthId || !userCode) {
      throw new Error("Received invalid response when requesting device code")
    }

    return {
      deviceAuthId,
      userCode,
      interval: parseInterval(body.interval),
      verificationUri: DEVICE_LOGIN_URL,
    }
  }

  export function printDeviceCodePrompt(code: string, verificationUrl = DEVICE_LOGIN_URL): void {
    console.log(`
Welcome to Codex

Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   ${verificationUrl}

2. Enter this one-time code (expires in 15 minutes)
   ${code}

Device codes are a common phishing target. Never share this code.
    `)
  }

  export async function pollForToken(deviceAuthId: string, userCode: string, interval: number): Promise<TokenResponse> {
    const url = issuerPath("/api/accounts/deviceauth/token")
    const startTime = Date.now()
    const maxWait = DEVICE_AUTH_TIMEOUT_MS
    const pollIntervalMs = Math.max(interval, 5) * 1000

    while (true) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_auth_id: deviceAuthId,
          user_code: userCode,
        }),
      })

      if (response.ok) {
        const payload = (await response.json()) as DeviceAuthTokenResponse
        return exchangeAuthorizationCodeForTokens(payload.authorization_code, payload.code_verifier)
      }

      if (response.status === 403 || response.status === 404) {
        if (Date.now() - startTime >= maxWait) {
          throw new Error("Device auth timed out after 15 minutes")
        }
        const remaining = maxWait - (Date.now() - startTime)
        await Bun.sleep(Math.min(pollIntervalMs, remaining))
        continue
      }

      const errorText = await response.text()
      throw new Error(`Device auth failed with status ${response.status} - ${errorText}`)
    }
  }

  async function exchangeAuthorizationCodeForTokens(code: string, codeVerifier: string): Promise<TokenResponse> {
    const url = issuerPath("/oauth/token")
    const redirectUri = issuerPath("/deviceauth/callback")

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: Config.clientId,
        code_verifier: codeVerifier,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Device auth failed with status ${response.status} - ${errorText}`)
    }

    const tokens = (await response.json()) as TokenResponse
    if (typeof tokens.expires_in !== "number") {
      tokens.expires_in = 3600
    }
    return tokens
  }

  export async function login(): Promise<void> {
    const userCodeResponse = await requestUserCode()
    printDeviceCodePrompt(userCodeResponse.userCode, userCodeResponse.verificationUri)

    const tokens = await pollForToken(userCodeResponse.deviceAuthId, userCodeResponse.userCode, userCodeResponse.interval)
    const idTokenInfo = parseIdToken(tokens.id_token)
    const expiresIn = tokens.expires_in ?? 3600

    await Auth.set("codex", {
      type: "codex",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      accountId: idTokenInfo?.chatgpt_account_id,
      expiresAt: Date.now() + expiresIn * 1000,
      email: idTokenInfo?.email,
      planType: idTokenInfo?.chatgpt_plan_type,
    })
  }

  export async function refresh(refreshToken: string): Promise<TokenResponse> {
    const url = `${Config.issuerBaseUrl}/oauth/token`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: Config.clientId,
        refresh_token: refreshToken,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to refresh token: ${response.status} - ${errorText}`)
    }

    const tokens = (await response.json()) as TokenResponse
    if (typeof tokens.expires_in !== "number") {
      tokens.expires_in = 3600
    }
    return tokens
  }

  export async function get<T>(path: string): Promise<T> {
    const auth = await Auth.get("codex")
    if (!auth || auth.type !== "codex") {
      throw new Error("Codex token not available")
    }

    if (Date.now() > auth.expiresAt) {
      try {
        const tokens = await refresh(auth.refreshToken)
        const idTokenInfo = parseIdToken(tokens.id_token)
        await Auth.set("codex", {
          ...auth,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          accountId: idTokenInfo?.chatgpt_account_id ?? auth.accountId,
        })
        auth.accessToken = tokens.access_token
      } catch (e) {
        throw new Error("Session expired, please login again")
      }
    }

    const url = `${normalizeBaseUrl(Config.chatgptBaseUrl)}${path}`
    const accountId = auth.accountId

    if (!accountId) {
      throw new Error("ChatGPT account ID not available, please re-run login")
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "chatgpt-account-id": accountId,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Request failed with status ${response.status}: ${body}`)
    }

    return (await response.json()) as T
  }

  export async function ensureValidToken(): Promise<string> {
    const auth = await Auth.get("codex")
    if (!auth || auth.type !== "codex") {
      throw new Error("Codex token not available")
    }

    // Refresh 5 minutes before expiration to be safe
    if (Date.now() > auth.expiresAt - 5 * 60 * 1000) {
      try {
        const tokens = await refresh(auth.refreshToken)
        const idTokenInfo = parseIdToken(tokens.id_token)
        const expiresIn = tokens.expires_in ?? 3600
        
        await Auth.set("codex", {
          ...auth,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          accountId: idTokenInfo?.chatgpt_account_id ?? auth.accountId,
        })
        return tokens.access_token
      } catch (e) {
        throw new Error("Session expired, please login again")
      }
    }
    return auth.accessToken
  }
}
