import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { data } from "./models-macro" with { type: "macro" }
import { Installation } from "../installation"

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string() }).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  const AMP_DEFAULT_URL = "https://ampcode.com"
  const AMP_BASE_URL = `${AMP_DEFAULT_URL}/api/provider/openai/v1`
  const AMP_DEFAULT_LIMIT = { context: 128_000, output: 8_192 }
  const AMP_DEFAULT_COST = { input: 0, output: 0 }
  const AMP_DEFAULT_RELEASE_DATE = "2025-01-01"

  const AMP_MODELS: Record<string, Model> = {
    "gpt-5.1": {
      id: "gpt-5.1",
      name: "GPT-5.1",
      family: "gpt",
      release_date: AMP_DEFAULT_RELEASE_DATE,
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      limit: { context: 400_000, output: 128_000 },
      modalities: { input: ["text", "image"], output: ["text"] },
      cost: AMP_DEFAULT_COST,
      options: {},
    },
    "gpt-5.2": {
      id: "gpt-5.2",
      name: "GPT-5.2",
      family: "gpt",
      release_date: AMP_DEFAULT_RELEASE_DATE,
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      limit: { context: 400_000, output: 128_000 },
      modalities: { input: ["text", "image"], output: ["text"] },
      cost: AMP_DEFAULT_COST,
      options: {},
    },
    "gpt-5": {
      id: "gpt-5",
      name: "GPT-5",
      family: "gpt",
      release_date: AMP_DEFAULT_RELEASE_DATE,
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      limit: { context: 400_000, output: 128_000 },
      modalities: { input: ["text", "image"], output: ["text"] },
      cost: AMP_DEFAULT_COST,
      options: {},
    },
  }

  const LOCAL_PROVIDERS: Record<string, Provider> = {
    amp: {
      id: "amp",
      name: "Amp",
      api: AMP_BASE_URL,
      env: ["AMP_API_KEY"],
      npm: "@ai-sdk/openai-compatible",
      models: AMP_MODELS,
    },
  }

  export async function get() {
    refresh()
    const file = Bun.file(filepath)
    const result = await file.json().catch(() => {})
    const base = result ? (result as Record<string, Provider>) : (JSON.parse(await data()) as Record<string, Provider>)
    for (const [id, provider] of Object.entries(LOCAL_PROVIDERS)) {
      if (!base[id]) base[id] = provider
    }

    // Add Antigravity provider locally since it's not in models.dev yet
    if (!base["antigravity"]) {
      base["antigravity"] = {
        id: "antigravity",
        name: "Antigravity",
        env: [],
        npm: "@ai-sdk/google", // Uses Google SDK internally
        models: {
          // Basic placeholder models - real ones are handled dynamically
          "gemini-2.0-flash-thinking-exp-01-21": {
            id: "gemini-2.0-flash-thinking-exp-01-21",
            name: "Gemini 2.0 Flash Thinking",
            release_date: "2025-01-21",
            attachment: true,
            reasoning: true,
            temperature: true,
            tool_call: true,
            limit: { context: 1_000_000, output: 8192 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
      }
    }

    return base
  }

  export async function refresh() {
    const file = Bun.file(filepath)
    log.info("refreshing", {
      file,
    })
    const result = await fetch("https://models.dev/api.json", {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
    if (result && result.ok) await Bun.write(file, await result.text())
  }
}

setInterval(() => ModelsDev.refresh(), 60 * 1000 * 60).unref()
