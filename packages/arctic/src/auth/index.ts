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

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown, Codex, Github]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "auth.json")

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
      return {
        type: "codex",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken,
        accountId: tokens.account_id ?? idInfo?.chatgpt_account_id ?? undefined,
        email: idInfo?.email,
        planType: idInfo?.chatgpt_plan_type,
        expiresAt: Date.now() - 60 * 1000,
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

    return entries
  }
}
