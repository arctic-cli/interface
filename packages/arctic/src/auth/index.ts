import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import os from "os"
import z from "zod"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
      groupId: z.string().optional(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const Codex = z
    .object({
      type: z.literal("codex"),
      accessToken: z.string(),
      refreshToken: z.string(),
      idToken: z.string(),
      accountId: z.string().optional(),
      expiresAt: z.number(),
      email: z.string().optional(),
      planType: z.string().optional(),
    })
    .meta({ ref: "CodexAuth" })

  export const Github = z
    .object({
      type: z.literal("github"),
      token: z.string(),
    })
    .meta({ ref: "GithubAuth" })

  export const Ollama = z
    .object({
      type: z.literal("ollama"),
      host: z.string(),
      port: z.number(),
    })
    .meta({ ref: "OllamaAuth" })

  export const Alibaba = z
    .object({
      type: z.literal("alibaba"),
      access: z.string(),
      refresh: z.string(),
      expires: z.number(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "AlibabaAuth" })

  export const Info = z
    .discriminatedUnion("type", [Oauth, Api, WellKnown, Codex, Github, Ollama, Alibaba])
    .meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "auth.json")

  export function parseKey(key: string): { provider: string; connection?: string } {
    const parts = key.split(":")
    if (parts.length === 1) return { provider: parts[0] }
    return { provider: parts[0], connection: parts.slice(1).join(":") }
  }

  export function formatKey(provider: string, connection?: string): string {
    if (!connection) return provider
    return `${provider}:${connection}`
  }

  export function formatDisplayName(provider: string, connection?: string): string {
    if (!connection) return provider
    return `${provider} (${connection})`
  }

  export function parseDisplayName(displayName: string): { provider: string; connection?: string } {
    const match = displayName.match(/^(.+?)\s*\((.+)\)$/)
    if (!match) return { provider: displayName }
    return { provider: match[1], connection: match[2] }
  }

  export async function listConnections(provider: string): Promise<Array<{ key: string; connection?: string; info: Info }>> {
    const auth = await all()
    const connections: Array<{ key: string; connection?: string; info: Info }> = []
    
    for (const [key, info] of Object.entries(auth)) {
      const parsed = parseKey(key)
      if (parsed.provider === provider) {
        connections.push({ key, connection: parsed.connection, info })
      }
    }
    
    return connections
  }

  export function validateConnectionName(name: string): string | undefined {
    if (!name || name.length === 0) return "Connection name is required"
    if (name.length > 32) return "Connection name must be 32 characters or less"
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return "Connection name can only contain letters, numbers, hyphens, and underscores"
    return undefined
  }

  export function suggestConnectionName(info: Info): string | undefined {
    if (info.type === "codex" && info.email) {
      const domain = info.email.split("@")[1]
      if (domain) {
        const name = domain.split(".")[0]
        return name
      }
    }
    if (info.type === "oauth" && "email" in info && typeof info.email === "string") {
      const domain = info.email.split("@")[1]
      if (domain) {
        const name = domain.split(".")[0]
        return name
      }
    }
    return undefined
  }

  async function readLocalAuth(): Promise<Record<string, Info>> {
    const file = Bun.file(filepath)
    const data = await file.json().catch(() => ({}) as Record<string, unknown>)
    return Object.entries(data).reduce(
      (acc, [key, value]) => {
        const parsed = Info.safeParse(value)
        if (!parsed.success) return acc
        acc[key] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    return readLocalAuth()
  }

  export async function set(key: string, info: Info) {
    const file = Bun.file(filepath)
    const data = await readLocalAuth()
    await Bun.write(file, JSON.stringify({ ...data, [key]: info }, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export async function remove(key: string) {
    const file = Bun.file(filepath)
    const data = await readLocalAuth()
    delete data[key]
    await Bun.write(file, JSON.stringify(data, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export async function external(): Promise<Record<string, Info>> {
    return loadExternalAuth()
  }

  interface CodexCliAuthFile {
    OPENAI_API_KEY?: string | null
    tokens?: {
      id_token?: string | { raw_jwt?: string } | null
      access_token?: string | null
      refresh_token?: string | null
      account_id?: string | null
    } | null
  }

  interface GeminiOauthFile {
    access_token?: string | null
    refresh_token?: string | null
    expiry_date?: number | null
  }

  interface ClaudeOauthFile {
    claudeAiOauth?: {
      accessToken?: string | null
      refreshToken?: string | null
      expiresAt?: number | null
      scopes?: string[] | null
      subscriptionType?: string | null
      rateLimitTier?: string | null
    } | null
  }

  function resolveCodexHome(): string {
    const envPath = process.env.CODEX_HOME?.trim()
    if (envPath) return path.resolve(envPath)
    return path.join(os.homedir(), ".codex")
  }

  async function readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const contents = await fs.readFile(filePath, "utf8")
      return JSON.parse(contents) as T
    } catch {
      return null
    }
  }

  function extractCodexIdToken(raw: unknown): string | undefined {
    if (!raw) return undefined
    if (typeof raw === "string") return raw
    if (typeof raw === "object" && "raw_jwt" in raw && typeof raw.raw_jwt === "string") return raw.raw_jwt
    return undefined
  }

  function parseCodexIdToken(idToken: string): {
    email?: string
    chatgpt_plan_type?: string
    chatgpt_account_id?: string
  } | null {
    try {
      const parts = idToken.split(".")
      if (parts.length !== 3) return null
      const payloadB64 = parts[1]
      let base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/")
      while (base64.length % 4) {
        base64 += "="
      }
      const payloadBytes = Buffer.from(base64, "base64").toString("utf-8")
      const payload = JSON.parse(payloadBytes)
      const authClaims = payload["https://api.openai.com/auth"]
      return {
        email: payload.email,
        chatgpt_plan_type: authClaims?.chatgpt_plan_type,
        chatgpt_account_id: authClaims?.chatgpt_account_id,
      }
    } catch {
      return null
    }
  }

  async function loadCodexAuth(): Promise<Info | null> {
    const authFile = await readJsonFile<CodexCliAuthFile>(path.join(resolveCodexHome(), "auth.json"))
    if (!authFile) return null

    const tokens = authFile.tokens ?? undefined
    const idToken = extractCodexIdToken(tokens?.id_token)
    if (tokens?.access_token && tokens?.refresh_token && idToken) {
      const idInfo = parseCodexIdToken(idToken)

      // Extract real expiry time from access token JWT instead of forcing refresh
      let expiresAt = Date.now() + 3600 * 1000 // Default: 1 hour from now
      try {
        const parts = tokens.access_token.split(".")
        if (parts.length === 3) {
          const payloadB64 = parts[1]
          let base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/")
          while (base64.length % 4) {
            base64 += "="
          }
          const payloadBytes = Buffer.from(base64, "base64").toString("utf-8")
          const payload = JSON.parse(payloadBytes)
          if (payload.exp && typeof payload.exp === "number") {
            expiresAt = payload.exp * 1000 // Convert Unix timestamp to milliseconds
          }
        }
      } catch {
        // If decoding fails, use default expiry
      }

      return {
        type: "codex",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken,
        accountId: tokens.account_id ?? idInfo?.chatgpt_account_id ?? undefined,
        email: idInfo?.email,
        planType: idInfo?.chatgpt_plan_type,
        expiresAt,
      }
    }

    if (authFile.OPENAI_API_KEY && authFile.OPENAI_API_KEY.trim().length > 0) {
      return {
        type: "api",
        key: authFile.OPENAI_API_KEY,
      }
    }

    return null
  }

  async function loadGeminiAuth(): Promise<Info | null> {
    const authFile = await readJsonFile<GeminiOauthFile>(path.join(os.homedir(), ".gemini", "oauth_creds.json"))
    if (!authFile) return null

    if (!authFile.access_token || !authFile.refresh_token) return null

    const expires =
      typeof authFile.expiry_date === "number" && Number.isFinite(authFile.expiry_date)
        ? authFile.expiry_date
        : Date.now() + 3600 * 1000

    return {
      type: "oauth",
      access: authFile.access_token,
      refresh: authFile.refresh_token,
      expires,
    }
  }

  async function loadClaudeAuth(): Promise<Info | null> {
    const authFile = await readJsonFile<ClaudeOauthFile>(path.join(os.homedir(), ".claude", ".credentials.json"))
    if (!authFile?.claudeAiOauth) return null

    const { accessToken, refreshToken, expiresAt } = authFile.claudeAiOauth
    if (!accessToken || !refreshToken) return null

    const expires = typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : Date.now() + 3600 * 1000

    return {
      type: "oauth",
      access: accessToken,
      refresh: refreshToken,
      expires,
    }
  }

  async function loadExternalAuth(): Promise<Record<string, Info>> {
    const entries: Record<string, Info> = {}

    const codex = await loadCodexAuth()
    if (codex) {
      const parsed = Info.safeParse(codex)
      if (parsed.success) entries.codex = parsed.data
    }

    const google = await loadGeminiAuth()
    if (google) {
      const parsed = Info.safeParse(google)
      if (parsed.success) entries.google = parsed.data
    }

    const claude = await loadClaudeAuth()
    if (claude) {
      const parsed = Info.safeParse(claude)
      if (parsed.success) entries.anthropic = parsed.data
    }

    return entries
  }
}
