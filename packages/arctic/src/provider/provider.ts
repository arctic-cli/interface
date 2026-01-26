import { iife } from "@/util/iife"
import { NamedError } from "@arctic-cli/util/error"
import { NoSuchModelError, type Provider as SDK } from "ai"
import fuzzysort from "fuzzysort"
import { mapValues, mergeDeep, sortBy } from "remeda"
import z from "zod"
import { Auth } from "../auth"
import { CodexClient } from "../auth/codex"
import { ensureAnthropicTokenValid } from "../auth/anthropic-oauth"
import { BunProc } from "../bun"
import { Config } from "../config/config"
import { Env } from "../env"
import { Flag } from "../flag/flag"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { ModelsDev } from "./models"

// Direct imports for bundled providers
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createAzure } from "@ai-sdk/azure"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createVertex } from "@ai-sdk/google-vertex"
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenRouter, type LanguageModelV2 } from "@openrouter/ai-sdk-provider"
import { createOpenaiCompatible } from "./sdk/openai-compatible/src"

export namespace Provider {
  const log = Log.create({ service: "provider" })
  const CHATGPT_CODEX_API_BASE = "https://chatgpt.com/backend-api/codex"

  const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
    "@ai-sdk/amazon-bedrock": createAmazonBedrock,
    "@ai-sdk/anthropic": createAnthropic,
    "@ai-sdk/azure": createAzure,
    "@ai-sdk/google": createGoogleGenerativeAI,
    "@ai-sdk/google-vertex": createVertex,
    "@ai-sdk/google-vertex/anthropic": createVertexAnthropic,
    "@ai-sdk/openai": createOpenAI,
    // @ts-ignore (TODO: kill this code so we dont have to maintain it)
    "@ai-sdk/openai-compatible": createOpenaiCompatible,
    "@openrouter/ai-sdk-provider": createOpenRouter,
    // @ts-ignore (TODO: kill this code so we dont have to maintain it)
    "@ai-sdk/github-copilot": createOpenaiCompatible,
  }

  type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
  type CustomLoader = (provider: Info) => Promise<{
    autoload: boolean
    getModel?: CustomModelLoader
    options?: Record<string, any>
  }>

  const CUSTOM_LOADERS: Record<string, CustomLoader> = {
    async anthropic() {
      return {
        autoload: false,
        options: {
          headers: {
            "anthropic-beta":
              "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
          },
        },
      }
    },
    async arctic(input) {
      if (!input) return { autoload: false }
      const hasKey = await (async () => {
        const env = Env.all()
        if (input.env.some((item) => env[item])) return true
        if (await Auth.get(input.id)) return true
        return false
      })()

      if (!hasKey) {
        for (const [key, value] of Object.entries(input.models)) {
          if (value.cost.input === 0) continue
          delete input.models[key]
        }
      }

      return {
        autoload: Object.keys(input.models).length > 0,
        options: hasKey ? {} : { apiKey: "public" },
      }
    },
    codex: async () => {
      const auth = await Auth.get("codex")
      let accessToken = auth?.type === "codex" ? auth.accessToken : undefined

      if (auth?.type === "codex") {
        try {
          accessToken = await CodexClient.ensureValidToken()
        } catch (e) {
          // If refresh fails, we might still try with the old token or just let it fail at the API level
          // but logging it would be good. For now, we proceed.
          // The ensureValidToken throws "Session expired", so usually we should probably not set the header?
          // provider.ts usually tries to be resilient.
          // But if ensureValidToken fails, it means we can't refresh.
        }
      }

      return {
        autoload: !!auth,
        async getModel(sdk: any, modelID: string) {
          return sdk.responses(modelID)
        },
        options: {
          headers:
            auth?.type === "codex" && accessToken
              ? {
                  Authorization: `Bearer ${accessToken}`,
                  "chatgpt-account-id": auth.accountId ?? "",
                }
              : {},
          baseURL: CHATGPT_CODEX_API_BASE,
        },
      }
    },
    antigravity: async () => {
      const auth = await Auth.get("antigravity")
      return {
        autoload: auth?.type === "oauth",
        options: {},
      }
    },
    amp: async () => {
      const raw = Env.get("AMP_URL") ?? "https://ampcode.com"
      const base = raw.replace(/\/$/, "")

      return {
        autoload: false,
        options: {
          baseURL: `${base}/api/provider/openai/v1`,
          // Add marker to change cache key so custom fetch is used
          _ampTransformParams: true,
          fetch: async (input: any, init?: BunFetchRequestInit) => {
            let opts = init ?? {}
            let url = input

            if (input instanceof Request) {
              const req = input as Request
              url = req.url
              opts = {
                ...opts,
                method: req.method,
                headers: req.headers,
                body: req.body ? await req.text() : undefined,
                signal: opts.signal ?? req.signal,
              }
            }

            // Transform max_tokens to max_completion_tokens for newer models
            if (opts?.body) {
              try {
                let rawBody: string | undefined
                if (typeof opts.body === "string") {
                  rawBody = opts.body
                } else if (opts.body instanceof Uint8Array) {
                  rawBody = new TextDecoder().decode(opts.body)
                } else if (opts.body instanceof ArrayBuffer) {
                  rawBody = new TextDecoder().decode(new Uint8Array(opts.body))
                } else if (opts.body instanceof ReadableStream) {
                  rawBody = await new Response(opts.body).text()
                }
                if (rawBody) {
                  const body = JSON.parse(rawBody)
                  if (body.max_tokens !== undefined) {
                    body.max_completion_tokens = body.max_tokens
                    delete body.max_tokens
                    opts.body = JSON.stringify(body)
                  }
                  if (body.temperature === 0) {
                    delete body.temperature
                    opts.body = JSON.stringify(body)
                  }
                }
              } catch {
                // If body parsing fails, just continue with original request
              }
            }
            return fetch(url, opts)
          },
        },
      }
    },
    openai: async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          if (modelID.includes("codex")) {
            return sdk.responses(modelID)
          }
          return sdk.chat(modelID)
        },
        options: {},
      }
    },
    "github-copilot": async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          if (modelID.includes("codex")) {
            return sdk.responses(modelID)
          }
          return sdk.chat(modelID)
        },
        options: {},
      }
    },
    "github-copilot-enterprise": async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          if (modelID.includes("codex")) {
            return sdk.responses(modelID)
          }
          return sdk.chat(modelID)
        },
        options: {},
      }
    },
    azure: async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
          if (options?.["useCompletionUrls"]) {
            return sdk.chat(modelID)
          } else {
            return sdk.responses(modelID)
          }
        },
        options: {},
      }
    },
    "azure-cognitive-services": async () => {
      const resourceName = Env.get("AZURE_COGNITIVE_SERVICES_RESOURCE_NAME")
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
          if (options?.["useCompletionUrls"]) {
            return sdk.chat(modelID)
          } else {
            return sdk.responses(modelID)
          }
        },
        options: {
          baseURL: resourceName ? `https://${resourceName}.cognitiveservices.azure.com/openai` : undefined,
        },
      }
    },
    "amazon-bedrock": async () => {
      const [awsProfile, awsAccessKeyId, awsBearerToken, awsRegion] = await Promise.all([
        Env.get("AWS_PROFILE"),
        Env.get("AWS_ACCESS_KEY_ID"),
        Env.get("AWS_BEARER_TOKEN_BEDROCK"),
        Env.get("AWS_REGION"),
      ])
      if (!awsProfile && !awsAccessKeyId && !awsBearerToken) return { autoload: false }

      const region = awsRegion ?? "us-east-1"

      const { fromNodeProviderChain } = await import(await BunProc.install("@aws-sdk/credential-providers"))
      return {
        autoload: true,
        options: {
          region,
          credentialProvider: fromNodeProviderChain(),
        },
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          // Skip region prefixing if model already has global prefix
          if (modelID.startsWith("global.")) {
            return sdk.languageModel(modelID)
          }

          let regionPrefix = region.split("-")[0]

          switch (regionPrefix) {
            case "us": {
              const modelRequiresPrefix = [
                "nova-micro",
                "nova-lite",
                "nova-pro",
                "nova-premier",
                "claude",
                "deepseek",
              ].some((m) => modelID.includes(m))
              const isGovCloud = region.startsWith("us-gov")
              if (modelRequiresPrefix && !isGovCloud) {
                modelID = `${regionPrefix}.${modelID}`
              }
              break
            }
            case "eu": {
              const regionRequiresPrefix = [
                "eu-west-1",
                "eu-west-2",
                "eu-west-3",
                "eu-north-1",
                "eu-central-1",
                "eu-south-1",
                "eu-south-2",
              ].some((r) => region.includes(r))
              const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "llama3", "pixtral"].some((m) =>
                modelID.includes(m),
              )
              if (regionRequiresPrefix && modelRequiresPrefix) {
                modelID = `${regionPrefix}.${modelID}`
              }
              break
            }
            case "ap": {
              const isAustraliaRegion = ["ap-southeast-2", "ap-southeast-4"].includes(region)
              if (
                isAustraliaRegion &&
                ["anthropic.claude-sonnet-4-5", "anthropic.claude-haiku"].some((m) => modelID.includes(m))
              ) {
                regionPrefix = "au"
                modelID = `${regionPrefix}.${modelID}`
              } else {
                const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) =>
                  modelID.includes(m),
                )
                if (modelRequiresPrefix) {
                  regionPrefix = "apac"
                  modelID = `${regionPrefix}.${modelID}`
                }
              }
              break
            }
          }

          return sdk.languageModel(modelID)
        },
      }
    },
    openrouter: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://usearctic.sh/",
            "X-Title": "arctic",
          },
        },
      }
    },
    vercel: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "http-referer": "https://usearctic.sh/",
            "x-title": "arctic",
          },
        },
      }
    },
    "google-vertex": async () => {
      const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
      const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "us-east5"
      const autoload = Boolean(project)
      if (!autoload) return { autoload: false }
      return {
        autoload: true,
        options: {
          project,
          location,
        },
        async getModel(sdk: any, modelID: string) {
          const id = String(modelID).trim()
          return sdk.languageModel(id)
        },
      }
    },
    "google-vertex-anthropic": async () => {
      const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
      const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "global"
      const autoload = Boolean(project)
      if (!autoload) return { autoload: false }
      return {
        autoload: true,
        options: {
          project,
          location,
        },
        async getModel(sdk: any, modelID) {
          const id = String(modelID).trim()
          return sdk.languageModel(id)
        },
      }
    },
    "sap-ai-core": async () => {
      const auth = await Auth.get("sap-ai-core")
      const envServiceKey = iife(() => {
        const envAICoreServiceKey = Env.get("AICORE_SERVICE_KEY")
        if (envAICoreServiceKey) return envAICoreServiceKey
        if (auth?.type === "api") {
          Env.set("AICORE_SERVICE_KEY", auth.key)
          return auth.key
        }
        return undefined
      })
      const deploymentId = Env.get("AICORE_DEPLOYMENT_ID")
      const resourceGroup = Env.get("AICORE_RESOURCE_GROUP")

      return {
        autoload: !!envServiceKey,
        options: envServiceKey ? { deploymentId, resourceGroup } : {},
        async getModel(sdk: any, modelID: string) {
          return sdk(modelID)
        },
      }
    },
    zenmux: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://usearctic.sh/",
            "X-Title": "arctic",
          },
        },
      }
    },
    cerebras: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "X-Cerebras-3rd-Party-Integration": "arctic",
          },
        },
      }
    },
    minimax: async () => {
      return {
        autoload: false,
        options: {
          baseURL: "https://api.minimax.io/anthropic/v1",
        },
      }
    },
    "minimax-coding-plan": async () => {
      return {
        autoload: false,
        options: {
          baseURL: "https://api.minimax.io/anthropic/v1",
        },
      }
    },
    ollama: async () => {
      const auth = await Auth.get("ollama")
      if (auth?.type !== "ollama") return { autoload: false }

      const baseURL = `http://${auth.host}:${auth.port}/v1`

      return {
        autoload: true,
        options: {
          baseURL,
        },
      }
    },
    alibaba: async () => {
      const { ensureAuth, getApiBaseUrl } = await import("../auth/qwen-oauth")
      const auth = await Auth.get("alibaba")
      const alibabaAuth = auth?.type === "alibaba" ? auth : undefined

      return {
        autoload: !!alibabaAuth,
        options: {
          baseURL: getApiBaseUrl(alibabaAuth?.enterpriseUrl),
          // Add marker to change cache key so custom fetch is used
          _qwenOauthTransform: true,
          fetch: async (input: any, init?: BunFetchRequestInit) => {
            // Refresh token on each request
            const freshAuth = await Auth.get("alibaba")
            const freshAlibabaAuth = freshAuth?.type === "alibaba" ? freshAuth : undefined
            const accessToken = await ensureAuth(freshAlibabaAuth ?? undefined)

            if (!accessToken) {
              throw new Error(
                "Alibaba authentication failed. Please run 'arctic auth' and re-authenticate with your Qwen account.",
              )
            }

            let opts = init ?? {}
            let url = input

            if (input instanceof Request) {
              const req = input as Request
              url = req.url
              opts = {
                ...opts,
                method: req.method,
                headers: req.headers,
                body: req.body ? await req.text() : undefined,
                signal: opts.signal ?? req.signal,
              }
            }

            // Add auth headers
            const headers = new Headers(opts.headers)
            headers.set("Authorization", `Bearer ${accessToken}`)
            headers.set("X-DashScope-AuthType", "qwen_oauth")

            return fetch(url, {
              ...opts,
              headers,
            })
          },
        },
      }
    },
    google: async () => {
      const auth = await Auth.get("google")
      const codeAssistHeaders = {
        "User-Agent": "google-api-nodejs-client/9.15.1",
        "X-Goog-Api-Client": "gl-node/22.17.0",
        "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
      } as const
      const projectContextCache = new Map<string, string>()
      const projectContextPending = new Map<string, Promise<string>>()

      // For API key authentication
      if (auth?.type === "api") {
        return {
          autoload: true,
          options: {
            apiKey: auth.key,
          },
        }
      }

      // For OAuth authentication with automatic token refresh
      if (auth?.type === "oauth") {
        return {
          autoload: true,
          options: {
            // Don't set baseURL - we'll transform the full URL in the fetch function
            async fetch(input: any, init?: BunFetchRequestInit) {
              async function loadManagedProject(accessToken: string, projectId?: string): Promise<any | null> {
                try {
                  const metadata: Record<string, string> = {
                    ideType: "IDE_UNSPECIFIED",
                    platform: "PLATFORM_UNSPECIFIED",
                    pluginType: "GEMINI",
                  }
                  if (projectId) {
                    metadata.duetProject = projectId
                  }

                  const requestBody: Record<string, unknown> = { metadata }
                  if (projectId) {
                    requestBody.cloudaicompanionProject = projectId
                  }

                  const response = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${accessToken}`,
                      ...codeAssistHeaders,
                    },
                    body: JSON.stringify(requestBody),
                  })

                  if (!response.ok) {
                    return null
                  }

                  return await response.json()
                } catch (error) {
                  log.error("google oauth load managed project failed", { error })
                  return null
                }
              }

              async function onboardManagedProject(
                accessToken: string,
                tierId: string,
                projectId?: string,
                attempts = 10,
                delayMs = 5000,
              ): Promise<string | undefined> {
                const metadata: Record<string, string> = {
                  ideType: "IDE_UNSPECIFIED",
                  platform: "PLATFORM_UNSPECIFIED",
                  pluginType: "GEMINI",
                }
                if (projectId) {
                  metadata.duetProject = projectId
                }

                const requestBody: Record<string, unknown> = {
                  tierId,
                  metadata,
                }

                if (tierId !== "FREE" && !projectId) {
                  throw new Error(
                    "Gemini requires a Google Cloud project for non-free tiers. Set GOOGLE_CLOUD_PROJECT.",
                  )
                }

                if (projectId) {
                  requestBody.cloudaicompanionProject = projectId
                }

                for (let attempt = 0; attempt < attempts; attempt += 1) {
                  try {
                    const response = await fetch("https://cloudcode-pa.googleapis.com/v1internal:onboardUser", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${accessToken}`,
                        ...codeAssistHeaders,
                      },
                      body: JSON.stringify(requestBody),
                    })

                    if (!response.ok) {
                      return undefined
                    }

                    const payload = await response.json()
                    const managedProjectId = payload?.response?.cloudaicompanionProject?.id
                    if (payload?.done && managedProjectId) {
                      return managedProjectId
                    }
                    if (payload?.done && projectId) {
                      return projectId
                    }
                  } catch (error) {
                    log.error("google oauth onboard managed project failed", { error })
                    return undefined
                  }

                  await new Promise((resolve) => setTimeout(resolve, delayMs))
                }

                return undefined
              }

              async function ensureProjectContext(accessToken: string): Promise<string> {
                if (!accessToken) {
                  throw new Error("Missing Google OAuth access token")
                }
                const configuredProjectId =
                  Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
                const cacheKey = configuredProjectId?.trim() || "default"
                const cached = projectContextCache.get(cacheKey)
                if (cached) return cached
                const pending = projectContextPending.get(cacheKey)
                if (pending) return pending

                const promise = (async () => {
                  const projectId = configuredProjectId?.trim() || undefined
                  if (projectId) {
                    projectContextCache.set(cacheKey, projectId)
                    return projectId
                  }

                  const loadPayload = await loadManagedProject(accessToken, projectId)
                  if (loadPayload?.cloudaicompanionProject) {
                    const managedProjectId = loadPayload.cloudaicompanionProject
                    projectContextCache.set(cacheKey, managedProjectId)
                    return managedProjectId
                  }

                  if (!loadPayload) {
                    throw new Error(
                      "Gemini requires a Google Cloud project. Enable the Gemini for Google Cloud API on a project you control.",
                    )
                  }

                  const currentTierId = loadPayload?.currentTier?.id ?? undefined
                  if (currentTierId && currentTierId !== "FREE") {
                    throw new Error(
                      "Gemini requires a Google Cloud project for non-free tiers. Set GOOGLE_CLOUD_PROJECT.",
                    )
                  }

                  const allowedTiers = Array.isArray(loadPayload?.allowedTiers) ? loadPayload.allowedTiers : []
                  let defaultTierId: string | undefined
                  for (const tier of allowedTiers) {
                    if (tier?.isDefault) {
                      defaultTierId = tier.id
                      break
                    }
                  }
                  const tierId = defaultTierId ?? allowedTiers[0]?.id ?? "FREE"

                  if (tierId !== "FREE") {
                    throw new Error(
                      "Gemini requires a Google Cloud project for non-free tiers. Set GOOGLE_CLOUD_PROJECT.",
                    )
                  }

                  const managedProjectId = await onboardManagedProject(accessToken, tierId, projectId)
                  if (!managedProjectId) {
                    throw new Error("Failed to resolve a managed Gemini project.")
                  }

                  projectContextCache.set(cacheKey, managedProjectId)
                  return managedProjectId
                })().finally(() => {
                  projectContextPending.delete(cacheKey)
                })

                projectContextPending.set(cacheKey, promise)
                return promise
              }

              // Get current auth and check if token needs refresh
              const currentAuth = await Auth.get("google")
              let accessToken = currentAuth?.type === "oauth" ? currentAuth.access : null

              const parseRefreshToken = (refresh: string | null | undefined) => (refresh ?? "").split("|")[0] || ""

              // Check if token needs refresh (5 minutes before expiration)
              if (currentAuth?.type === "oauth" && Date.now() > currentAuth.expires - 5 * 60 * 1000) {
                try {
                  // Silent refresh to avoid polluting chat output.
                  // Refresh the token using google-auth-library
                  const { OAuth2Client } = await import("google-auth-library")
                  const client = new OAuth2Client({
                    clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
                    clientSecret: "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",
                  })

                  client.setCredentials({
                    refresh_token: parseRefreshToken(currentAuth.refresh),
                  })

                  const { credentials } = await client.refreshAccessToken()

                  if (credentials.access_token) {
                    // Update stored tokens
                    const expires =
                      typeof credentials.expiry_date === "number" && Number.isFinite(credentials.expiry_date)
                        ? credentials.expiry_date
                        : Date.now() + 3600 * 1000
                    await Auth.set("google", {
                      type: "oauth",
                      access: credentials.access_token,
                      refresh: currentAuth.refresh,
                      expires,
                    })
                    accessToken = credentials.access_token
                    // Token refreshed successfully.
                  }
                } catch (error) {
                  log.error("google oauth token refresh failed", { error })
                }
              }

              // Transform the request to Code Assist format
              let url = typeof input === "string" ? input : input.url
              const isGenerateContent = url.includes("generateContent") || url.includes("streamGenerateContent")
              const isStreaming = url.includes("streamGenerateContent")

              if (isGenerateContent && init?.body) {
                try {
                  const body = JSON.parse(init.body as string)

                  // Extract model from URL (e.g., /models/gemini-2.0-flash-exp:generateContent)
                  const modelMatch = url.match(/models\/([^:]+)/)
                  const model = modelMatch ? modelMatch[1] : "gemini-2.0-flash-exp"
                  if (!accessToken) {
                    return new Response("Unauthorized: Missing Google OAuth access token", { status: 401 })
                  }
                  const project = await ensureProjectContext(accessToken)

                  // Rewrite URL to Code Assist format
                  // From: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:streamGenerateContent
                  // To: https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse
                  const action = isStreaming ? "streamGenerateContent" : "generateContent"
                  url = `https://cloudcode-pa.googleapis.com/v1internal:${action}`

                  // Add SSE parameter for streaming
                  if (isStreaming) {
                    url += "?alt=sse"
                  }

                  // Update input if it's a Request object
                  if (typeof input !== "string") {
                    input = new Request(url, input)
                  } else {
                    input = url
                  }

                  const requestBody = { ...body }
                  if ("system_instruction" in requestBody && !("systemInstruction" in requestBody)) {
                    requestBody.systemInstruction = requestBody.system_instruction
                    delete requestBody.system_instruction
                  }
                  if ("sessionId" in requestBody && !("session_id" in requestBody)) {
                    requestBody.session_id = requestBody.sessionId
                    delete requestBody.sessionId
                  }

                  // Wrap request in Code Assist format
                  const caRequest = {
                    model,
                    project,
                    user_prompt_id: `prompt-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                    request: requestBody,
                  }

                  init.body = JSON.stringify(caRequest)
                } catch (error) {
                  log.error("google oauth request transform failed", { error })
                }
              }

              // Inject OAuth token and Code Assist headers
              if (accessToken) {
                const headers = new Headers(init?.headers || {})

                // Remove any API key headers that the SDK might have added
                headers.delete("x-goog-api-key")
                headers.delete("api-key")

                // Set OAuth Bearer token
                headers.set("Authorization", `Bearer ${accessToken}`)
                for (const [key, value] of Object.entries(codeAssistHeaders)) {
                  headers.set(key, value)
                }

                init = { ...init, headers }
              }

              // Make the request
              const response = await fetch(input, init)

              // Log error responses for debugging
              if (!response.ok) {
                const errorText = await response.text()
                return new Response(errorText, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                })
              }

              // Transform Code Assist response back to standard format
              if (isGenerateContent && response.ok) {
                // For streaming responses, don't parse as JSON
                if (isStreaming) {
                  if (!response.body) {
                    return response
                  }
                  const encoder = new TextEncoder()
                  const decoder = new TextDecoder()
                  let buffer = ""

                  const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                      if (!response.body) {
                        controller.close()
                        return
                      }
                      const reader = response.body.getReader()

                      const pump = async (): Promise<void> => {
                        const { done, value } = await reader.read()
                        if (done) {
                          controller.close()
                          return
                        }
                        buffer += decoder.decode(value, { stream: true })
                        const lines = buffer.split("\n")
                        buffer = lines.pop() ?? ""

                        for (const line of lines) {
                          if (!line.startsWith("data:")) {
                            controller.enqueue(encoder.encode(`${line}\n`))
                            continue
                          }

                          const jsonStr = line.slice(5).trim()
                          if (!jsonStr) {
                            controller.enqueue(encoder.encode("data:\n\n"))
                            continue
                          }
                          if (jsonStr === "[DONE]") {
                            controller.enqueue(encoder.encode("data: [DONE]\n\n"))
                            continue
                          }

                          try {
                            const parsed = JSON.parse(jsonStr)
                            const transformed = parsed?.response
                              ? { ...parsed.response, responseId: parsed.traceId }
                              : parsed
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(transformed)}\n\n`))
                          } catch (error) {
                            controller.enqueue(encoder.encode(`${line}\n`))
                          }
                        }

                        await pump()
                      }

                      void pump()
                    },
                  })

                  return new Response(stream, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                  })
                }

                const responseText = await response.text()
                // For non-streaming, parse and transform
                try {
                  const data = JSON.parse(responseText)

                  // Code Assist wraps response in { response: { ... }, traceId: ... }
                  if (data.response) {
                    const transformedResponse = {
                      ...data.response,
                      responseId: data.traceId,
                    }

                    return new Response(JSON.stringify(transformedResponse), {
                      status: response.status,
                      statusText: response.statusText,
                      headers: response.headers,
                    })
                  }

                  // If no wrapping, return as-is
                  return new Response(responseText, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                  })
                } catch (error) {
                  return new Response(responseText, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                  })
                }
              }

              return response
            },
          },
        }
      }

      return {
        autoload: false,
      }
    },
  }

  export const Model = z
    .object({
      id: z.string(),
      providerID: z.string(),
      api: z.object({
        id: z.string(),
        url: z.string(),
        npm: z.string(),
      }),
      name: z.string(),
      family: z.string().optional(),
      capabilities: z.object({
        temperature: z.boolean(),
        reasoning: z.boolean(),
        attachment: z.boolean(),
        toolcall: z.boolean(),
        input: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        output: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        interleaved: z.union([
          z.boolean(),
          z.object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          }),
        ]),
      }),
      cost: z.object({
        input: z.number(),
        output: z.number(),
        cache: z.object({
          read: z.number(),
          write: z.number(),
        }),
        experimentalOver200K: z
          .object({
            input: z.number(),
            output: z.number(),
            cache: z.object({
              read: z.number(),
              write: z.number(),
            }),
          })
          .optional(),
      }),
      limit: z.object({
        context: z.number(),
        output: z.number(),
      }),
      status: z.enum(["alpha", "beta", "deprecated", "active"]),
      options: z.record(z.string(), z.any()),
      headers: z.record(z.string(), z.string()),
    })
    .meta({
      ref: "Model",
    })
  export type Model = z.infer<typeof Model>

  export const Info = z
    .object({
      id: z.string(),
      name: z.string(),
      source: z.enum(["env", "config", "custom", "api"]),
      env: z.string().array(),
      key: z.string().optional(),
      options: z.record(z.string(), z.any()),
      models: z.record(z.string(), Model),
      baseProvider: z.string().optional(),
    })
    .meta({
      ref: "Provider",
    })
  export type Info = z.infer<typeof Info>

  function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    return {
      id: model.id,
      providerID: provider.id,
      name: model.name,
      family: model.family,
      api: {
        id: model.id,
        url: provider.api!,
        npm: model.provider?.npm ?? provider.npm ?? provider.id,
      },
      status: model.status ?? "active",
      headers: model.headers ?? {},
      options: model.options ?? {},
      cost: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        cache: {
          read: model.cost?.cache_read ?? 0,
          write: model.cost?.cache_write ?? 0,
        },
        experimentalOver200K: model.cost?.context_over_200k
          ? {
              cache: {
                read: model.cost.context_over_200k.cache_read ?? 0,
                write: model.cost.context_over_200k.cache_write ?? 0,
              },
              input: model.cost.context_over_200k.input,
              output: model.cost.context_over_200k.output,
            }
          : undefined,
      },
      limit: {
        context: model.limit.context,
        output: model.limit.output,
      },
      capabilities: {
        temperature: model.temperature,
        reasoning: model.reasoning,
        attachment: model.attachment,
        toolcall: model.tool_call,
        input: {
          text: model.modalities?.input?.includes("text") ?? false,
          audio: model.modalities?.input?.includes("audio") ?? false,
          image: model.modalities?.input?.includes("image") ?? false,
          video: model.modalities?.input?.includes("video") ?? false,
          pdf: model.modalities?.input?.includes("pdf") ?? false,
        },
        output: {
          text: model.modalities?.output?.includes("text") ?? false,
          audio: model.modalities?.output?.includes("audio") ?? false,
          image: model.modalities?.output?.includes("image") ?? false,
          video: model.modalities?.output?.includes("video") ?? false,
          pdf: model.modalities?.output?.includes("pdf") ?? false,
        },
        interleaved: model.interleaved ?? false,
      },
    }
  }

  export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
    return {
      id: provider.id,
      source: "custom",
      name: provider.name,
      env: provider.env ?? [],
      options: {},
      models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
    }
  }

  const state = Instance.state(async () => {
    using _ = log.time("state")
    const config = await Config.get()
    const modelsDev = await ModelsDev.get()
    const database = mapValues(modelsDev, fromModelsDevProvider)
    if (database["arctic"]) {
      database["arctic"] = { ...database["arctic"], id: "arctic" }
    }

    const codexAuth = await Auth.get("codex")
    if (codexAuth) {
      database["codex"] = {
        id: "codex",
        name: "Codex",
        source: "custom",
        env: [],
        options: {},
        models: {
          "gpt-5.2-codex": {
            id: "gpt-5.2-codex",
            providerID: "codex",
            name: "gpt-5.2-codex (Latest)",
            api: {
              id: "gpt-5.2-codex",
              url: CHATGPT_CODEX_API_BASE,
              npm: "@ai-sdk/openai-compatible",
            },
            status: "active",
            capabilities: {
              temperature: true,
              reasoning: true,
              attachment: true,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: true },
              output: { text: true, audio: false, image: true, video: false, pdf: false },
              interleaved: true,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 200_000, output: 8192 },
            options: {
              description: "Latest frontier agentic coding model (default in some contexts).",
            },
            headers: {},
          },
          "gpt-5.1-codex-max": {
            id: "gpt-5.1-codex-max",
            providerID: "codex",
            name: "gpt-5.1-codex-max",
            api: {
              id: "gpt-5.1-codex-max",
              url: CHATGPT_CODEX_API_BASE,
              npm: "@ai-sdk/openai-compatible",
            },
            status: "active",
            capabilities: {
              temperature: true,
              reasoning: true,
              attachment: true,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: true },
              output: { text: true, audio: false, image: true, video: false, pdf: false },
              interleaved: true,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 200_000, output: 8192 },
            options: {
              description: "Codex-optimized flagship for deep and fast reasoning (recommended default).",
            },
            headers: {},
          },
          "gpt-5.1-codex": {
            id: "gpt-5.1-codex",
            providerID: "codex",
            name: "gpt-5.1-codex",
            api: {
              id: "gpt-5.1-codex",
              url: CHATGPT_CODEX_API_BASE,
              npm: "@ai-sdk/openai-compatible",
            },
            status: "active",
            capabilities: {
              temperature: true,
              reasoning: true,
              attachment: true,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: true },
              output: { text: true, audio: false, image: true, video: false, pdf: false },
              interleaved: true,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 128_000, output: 8192 },
            options: {
              description: "Optimized for Codex usage.",
            },
            headers: {},
          },
          "gpt-5.1-codex-mini": {
            id: "gpt-5.1-codex-mini",
            providerID: "codex",
            name: "gpt-5.1-codex-mini",
            api: {
              id: "gpt-5.1-codex-mini",
              url: CHATGPT_CODEX_API_BASE,
              npm: "@ai-sdk/openai-compatible",
            },
            status: "active",
            capabilities: {
              temperature: true,
              reasoning: true,
              attachment: true,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: true },
              output: { text: true, audio: false, image: true, video: false, pdf: false },
              interleaved: true,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 64_000, output: 4096 },
            options: {
              description: "Cheaper, faster Codex-tuned model.",
            },
            headers: {},
          },
          "gpt-5.2": {
            id: "gpt-5.2",
            providerID: "codex",
            name: "gpt-5.2",
            api: {
              id: "gpt-5.2",
              url: CHATGPT_CODEX_API_BASE,
              npm: "@ai-sdk/openai-compatible",
            },
            status: "active",
            capabilities: {
              temperature: true,
              reasoning: true,
              attachment: true,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: true },
              output: { text: true, audio: false, image: true, video: false, pdf: false },
              interleaved: true,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 128_000, output: 8192 },
            options: {
              description: "General purpose model.",
            },
            headers: {},
          },
        },
      }
    }

    database["antigravity"] = {
      id: "antigravity",
      name: "Antigravity",
      source: "custom",
      env: [],
      options: {
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
      },
      models: {
        "gemini-3-pro-high": {
          id: "gemini-3-pro-high",
          providerID: "antigravity",
          name: "Gemini 3 Pro High (Antigravity)",
          api: {
            id: "gemini-3-pro-high",
            url: "https://generativelanguage.googleapis.com/v1beta",
            npm: "@ai-sdk/google",
          },
          status: "active",
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 1048576, output: 65535 },
          options: {},
          headers: {},
        },
        "gemini-3-pro-low": {
          id: "gemini-3-pro-low",
          providerID: "antigravity",
          name: "Gemini 3 Pro Low (Antigravity)",
          api: {
            id: "gemini-3-pro-low",
            url: "https://generativelanguage.googleapis.com/v1beta",
            npm: "@ai-sdk/google",
          },
          status: "active",
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 1048576, output: 65535 },
          options: {},
          headers: {},
        },
        "gemini-3-flash": {
          id: "gemini-3-flash",
          providerID: "antigravity",
          name: "Gemini 3 Flash (Antigravity)",
          api: {
            id: "gemini-3-flash",
            url: "https://generativelanguage.googleapis.com/v1beta",
            npm: "@ai-sdk/google",
          },
          status: "active",
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 1048576, output: 65536 },
          options: {},
          headers: {},
        },
        "claude-sonnet-4-5": {
          id: "claude-sonnet-4-5",
          providerID: "antigravity",
          name: "Claude Sonnet 4.5 (Antigravity)",
          api: {
            id: "claude-sonnet-4-5",
            url: "https://generativelanguage.googleapis.com/v1beta",
            npm: "@ai-sdk/google",
          },
          status: "active",
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 200000, output: 64000 },
          options: {},
          headers: {},
        },
        "claude-sonnet-4-5-thinking": {
          id: "claude-sonnet-4-5-thinking",
          providerID: "antigravity",
          name: "Claude Sonnet 4.5 Thinking (Antigravity)",
          api: {
            id: "claude-sonnet-4-5-thinking",
            url: "https://generativelanguage.googleapis.com/v1beta",
            npm: "@ai-sdk/google",
          },
          status: "active",
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 200000, output: 64000 },
          options: {},
          headers: {},
        },
        "claude-opus-4-5-thinking": {
          id: "claude-opus-4-5-thinking",
          providerID: "antigravity",
          name: "Claude Opus 4.5 Thinking (Antigravity)",
          api: {
            id: "claude-opus-4-5-thinking",
            url: "https://generativelanguage.googleapis.com/v1beta",
            npm: "@ai-sdk/google",
          },
          status: "active",
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 200000, output: 64000 },
          options: {},
          headers: {},
        },
      },
    }

    // Ollama provider - dynamically loads models from the local Ollama instance
    const ollamaAuth = await Auth.get("ollama")
    if (ollamaAuth?.type === "ollama") {
      const baseURL = `http://${ollamaAuth.host}:${ollamaAuth.port}/v1`
      const ollamaModels: Record<string, Model> = {}

      try {
        const response = await fetch(`${baseURL}/models`, {
          signal: AbortSignal.timeout(5000),
        })
        if (response.ok) {
          const data = (await response.json()) as { data: Array<{ id: string; owned_by: string; created: number }> }
          for (const model of data.data ?? []) {
            ollamaModels[model.id] = {
              id: model.id,
              providerID: "ollama",
              name: model.id,
              api: {
                id: model.id,
                url: baseURL,
                npm: "@ai-sdk/openai-compatible",
              },
              status: "active",
              capabilities: {
                temperature: true,
                reasoning: false,
                attachment: false,
                toolcall: true,
                input: { text: true, audio: false, image: false, video: false, pdf: false },
                output: { text: true, audio: false, image: false, video: false, pdf: false },
                interleaved: false,
              },
              cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
              limit: { context: 128000, output: 8192 },
              options: {},
              headers: {},
            }
          }
        }
      } catch {
        log.warn("ollama", { message: "Failed to fetch models from Ollama" })
      }

      if (Object.keys(ollamaModels).length > 0) {
        database["ollama"] = {
          id: "ollama",
          name: "Ollama",
          source: "custom",
          env: [],
          options: {
            baseURL,
          },
          models: ollamaModels,
        }
      }
    }

    database["minimax"] = {
      id: "minimax",
      name: "MiniMax",
      source: "custom",
      env: ["MINIMAX_API_KEY"],
      options: {
        baseURL: "https://api.minimax.io/anthropic/v1",
      },
      models: {
        "MiniMax-M2.1": {
          id: "MiniMax-M2.1",
          providerID: "minimax",
          name: "MiniMax-M2.1",
          api: {
            id: "MiniMax-M2.1",
            url: "https://api.minimax.io/anthropic/v1",
            npm: "@ai-sdk/anthropic",
          },
          status: "active",
          capabilities: {
            temperature: true,
            reasoning: false,
            attachment: false,
            toolcall: true,
            input: { text: true, audio: false, image: false, video: false, pdf: false },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0.3, output: 1.2, cache: { read: 0, write: 0 } },
          limit: { context: 128000, output: 8192 },
          options: {},
          headers: {},
        },
      },
    }

    database["minimax-coding-plan"] = {
      id: "minimax-coding-plan",
      name: "MiniMax Coding Plan",
      source: "custom",
      env: ["MINIMAX_CODING_PLAN_API_KEY", "MINIMAX_API_KEY"],
      options: {
        baseURL: "https://api.minimax.io/anthropic/v1",
      },
      models: {
        "MiniMax-M2.1": {
          id: "MiniMax-M2.1",
          providerID: "minimax-coding-plan",
          name: "MiniMax-M2.1 (Coding Plan)",
          api: {
            id: "MiniMax-M2.1",
            url: "https://api.minimax.io/anthropic/v1",
            npm: "@ai-sdk/anthropic",
          },
          status: "active",
          capabilities: {
            temperature: true,
            reasoning: false,
            attachment: false,
            toolcall: true,
            input: { text: true, audio: false, image: false, video: false, pdf: false },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0.3, output: 1.2, cache: { read: 0, write: 0 } },
          limit: { context: 128000, output: 8192 },
          options: {},
          headers: {},
        },
      },
    }

    const disabled = new Set(config.disabled_providers ?? [])
    const enabled = config.enabled_providers ? new Set(config.enabled_providers) : null

    function isProviderAllowed(providerID: string): boolean {
      if (enabled && !enabled.has(providerID)) return false
      if (disabled.has(providerID)) return false
      return true
    }

    const providers: { [providerID: string]: Info } = {}
    const languages = new Map<string, LanguageModelV2>()
    const modelLoaders: {
      [providerID: string]: CustomModelLoader
    } = {}
    const sdk = new Map<number, SDK>()

    log.info("init")

    const configProviders = Object.entries(config.provider ?? {})

    // Add GitHub Copilot Enterprise provider that inherits from GitHub Copilot
    if (database["github-copilot"]) {
      const githubCopilot = database["github-copilot"]
      database["github-copilot-enterprise"] = {
        ...githubCopilot,
        id: "github-copilot-enterprise",
        name: "GitHub Copilot Enterprise",
        models: mapValues(githubCopilot.models, (model) => ({
          ...model,
          providerID: "github-copilot-enterprise",
        })),
      }
    }

    function mergeProvider(providerID: string, provider: Partial<Info>) {
      const existing = providers[providerID]
      if (existing) {
        // @ts-expect-error
        providers[providerID] = mergeDeep(existing, provider)
        return
      }
      const match = database[providerID]
      if (!match) return
      // @ts-expect-error
      providers[providerID] = mergeDeep(match, provider)
    }

    // extend database from config
    for (const [providerID, provider] of configProviders) {
      const existing = database[providerID]
      const parsed: Info = {
        id: providerID,
        name: provider.name ?? existing?.name ?? providerID,
        env: provider.env ?? existing?.env ?? [],
        options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
        source: "config",
        models: existing?.models ?? {},
      }

      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        const existingModel = parsed.models[model.id ?? modelID]
        const name = iife(() => {
          if (model.name) return model.name
          if (model.id && model.id !== modelID) return modelID
          return existingModel?.name ?? modelID
        })
        const parsedModel: Model = {
          id: modelID,
          api: {
            id: model.id ?? existingModel?.api.id ?? modelID,
            npm:
              model.provider?.npm ?? provider.npm ?? existingModel?.api.npm ?? modelsDev[providerID]?.npm ?? providerID,
            url: provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api,
          },
          status: model.status ?? existingModel?.status ?? "active",
          name,
          providerID,
          capabilities: {
            temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
            reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
            attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
            toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
            input: {
              text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
              audio: model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
              image: model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
              video: model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
              pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
            },
            output: {
              text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
              audio: model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
              image: model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
              video: model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
              pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
            },
            interleaved: model.interleaved ?? false,
          },
          cost: {
            input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
            output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
            cache: {
              read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
              write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
            },
          },
          options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
          limit: {
            context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
            output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
          },
          headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
        }
        parsed.models[modelID] = parsedModel
      }
      database[providerID] = parsed
    }

    // load env
    const env = Env.all()
    for (const [providerID, provider] of Object.entries(database)) {
      if (disabled.has(providerID)) continue
      const apiKey = provider.env.map((item) => env[item]).find(Boolean)
      if (!apiKey) continue
      mergeProvider(providerID, {
        source: "env",
        key: provider.env.length === 1 ? apiKey : undefined,
      })
    }

    // load apikeys
    for (const [authKey, provider] of Object.entries(await Auth.all())) {
      const parsed = Auth.parseKey(authKey)
      if (disabled.has(parsed.provider)) continue

      if (provider.type === "api") {
        mergeProvider(authKey, {
          source: "api",
          key: provider.key,
        })
      }

      if (parsed.connection && database[parsed.provider]) {
        const baseProvider = database[parsed.provider]
        database[authKey] = {
          ...baseProvider,
          id: authKey,
          name: Auth.formatDisplayName(baseProvider.name || parsed.provider, parsed.connection),
          baseProvider: parsed.provider,
          models: mapValues(baseProvider.models, (model) => ({
            ...model,
            providerID: authKey,
          })),
        }
        // add virtual provider to providers object
        mergeProvider(authKey, {
          source: provider.type === "api" ? "api" : "custom",
          key: provider.type === "api" ? provider.key : undefined,
        })
      }
    }

    for (const plugin of await Plugin.list()) {
      if (!plugin.auth) continue
      const providerID = plugin.auth.provider
      if (disabled.has(providerID)) continue

      // For github-copilot plugin, check if auth exists for either github-copilot or github-copilot-enterprise
      let hasAuth = false
      const auth = await Auth.get(providerID)
      if (auth) hasAuth = true

      // Special handling for github-copilot: also check for enterprise auth
      if (providerID === "github-copilot" && !hasAuth) {
        const enterpriseAuth = await Auth.get("github-copilot-enterprise")
        if (enterpriseAuth) hasAuth = true
      }

      if (!hasAuth) continue
      if (!plugin.auth.loader) continue

      // Load for the main provider if auth exists
      if (auth) {
        const options = await plugin.auth.loader(() => Auth.get(providerID) as any, database[plugin.auth.provider])
        mergeProvider(plugin.auth.provider, {
          source: "custom",
          options: options,
        })
      }

      for (const authKey of Object.keys(database)) {
        const parsed = Auth.parseKey(authKey)
        if (parsed.provider === providerID && parsed.connection) {
          const connAuth = await Auth.get(authKey)
          if (connAuth && plugin.auth.loader) {
            const connOptions = await plugin.auth.loader(() => Auth.get(authKey) as any, database[authKey])
            mergeProvider(authKey, {
              source: "custom",
              options: connOptions,
            })
          }
        }
      }

      // If this is github-copilot plugin, also register for github-copilot-enterprise if auth exists
      if (providerID === "github-copilot") {
        const enterpriseProviderID = "github-copilot-enterprise"
        if (!disabled.has(enterpriseProviderID)) {
          const enterpriseAuth = await Auth.get(enterpriseProviderID)
          if (enterpriseAuth) {
            const enterpriseOptions = await plugin.auth.loader(
              () => Auth.get(enterpriseProviderID) as any,
              database[enterpriseProviderID],
            )
            mergeProvider(enterpriseProviderID, {
              source: "custom",
              options: enterpriseOptions,
            })
          }
        }
      }
    }

    for (const [providerID, fn] of Object.entries(CUSTOM_LOADERS)) {
      if (disabled.has(providerID)) continue
      const result = await fn(database[providerID])
      if (result && (result.autoload || providers[providerID])) {
        if (result.getModel) modelLoaders[providerID] = result.getModel
        mergeProvider(providerID, {
          source: "custom",
          options: result.options,
        })
      }

      for (const authKey of Object.keys(database)) {
        const parsed = Auth.parseKey(authKey)
        if (parsed.provider === providerID && parsed.connection) {
          const connResult = await fn(database[authKey])
          if (connResult && (connResult.autoload || providers[authKey])) {
            if (connResult.getModel) modelLoaders[authKey] = connResult.getModel
            mergeProvider(authKey, {
              source: "custom",
              options: connResult.options,
            })
          }
        }
      }
    }

    // load config
    for (const [providerID, provider] of configProviders) {
      const partial: Partial<Info> = { source: "config" }
      if (provider.env) partial.env = provider.env
      if (provider.name) partial.name = provider.name
      if (provider.options) partial.options = provider.options
      mergeProvider(providerID, partial)
    }

    for (const [providerID, provider] of Object.entries(providers)) {
      if (!isProviderAllowed(providerID)) {
        delete providers[providerID]
        continue
      }

      if (providerID === "github-copilot" || providerID === "github-copilot-enterprise") {
        provider.models = mapValues(provider.models, (model) => ({
          ...model,
          api: {
            ...model.api,
            npm: "@ai-sdk/github-copilot",
          },
        }))
      }

      const configProvider = config.provider?.[providerID]

      for (const [modelID, model] of Object.entries(provider.models)) {
        model.api.id = model.api.id ?? model.id ?? modelID
        if (modelID === "gpt-5-chat-latest" || (providerID === "openrouter" && modelID === "openai/gpt-5-chat"))
          delete provider.models[modelID]
        if (model.status === "alpha" && !Flag.ARCTIC_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
        if (
          (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
          (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
        )
          delete provider.models[modelID]
      }

      if (Object.keys(provider.models).length === 0) {
        delete providers[providerID]
        continue
      }

      log.info("found", { providerID })
    }

    return {
      models: languages,
      providers,
      sdk,
      modelLoaders,
    }
  })

  export async function list() {
    return state().then((state) => state.providers)
  }

  async function getSDK(model: Model) {
    try {
      using _ = log.time("getSDK", {
        providerID: model.providerID,
      })
      const s = await state()
      const provider = s.providers[model.providerID]
      const options = { ...provider.options }

      if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
        options["includeUsage"] = true
      }

      if (!options["baseURL"]) options["baseURL"] = model.api.url
      if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
      if (model.headers)
        options["headers"] = {
          ...options["headers"],
          ...model.headers,
        }

      const key = Bun.hash.xxHash32(JSON.stringify({ npm: model.api.npm, options }))
      const existing = s.sdk.get(key)
      if (existing) return existing

      const customFetch = options["fetch"]

      options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
        // Preserve custom fetch if it exists, wrap it with timeout logic
        const fetchFn = customFetch ?? fetch
        let opts = init ?? {}
        let url = input

        // If request is passed as Request, normalize so we can inspect/replace body
        if (input instanceof Request) {
          const req = input as Request
          url = req.url
          opts = {
            ...opts,
            method: req.method,
            headers: req.headers,
            body: req.body ? await req.text() : undefined,
            signal: opts.signal ?? req.signal,
          }
        }

        if (options["timeout"] !== undefined && options["timeout"] !== null) {
          const signals: AbortSignal[] = []
          if (opts.signal) signals.push(opts.signal)
          if (options["timeout"] !== false) signals.push(AbortSignal.timeout(options["timeout"]))

          const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0]

          opts.signal = combined
        }

        return fetchFn(url, {
          ...opts,
          // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
          timeout: false,
        })
      }

      // Special case: google-vertex-anthropic uses a subpath import
      const bundledKey =
        model.providerID === "google-vertex-anthropic" ? "@ai-sdk/google-vertex/anthropic" : model.api.npm
      const bundledFn = BUNDLED_PROVIDERS[bundledKey]
      if (bundledFn) {
        log.info("using bundled provider", { providerID: model.providerID, pkg: bundledKey })
        const loaded = bundledFn({
          name: model.providerID,
          ...options,
        })
        s.sdk.set(key, loaded)
        return loaded as SDK
      }

      let installedPath: string
      if (!model.api.npm.startsWith("file://")) {
        installedPath = await BunProc.install(model.api.npm, "latest")
      } else {
        log.info("loading local provider", { pkg: model.api.npm })
        installedPath = model.api.npm
      }

      const mod = await import(installedPath)

      const fn = mod[Object.keys(mod).find((key) => key.startsWith("create"))!]
      const loaded = fn({
        name: model.providerID,
        ...options,
      })
      s.sdk.set(key, loaded)
      return loaded as SDK
    } catch (e) {
      throw new InitError({ providerID: model.providerID }, { cause: e })
    }
  }

  export async function getProvider(providerID: string) {
    return state().then((s) => s.providers[providerID])
  }

  export async function getModel(providerID: string, modelID: string) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) {
      const availableProviders = Object.keys(s.providers)
      const matches = fuzzysort.go(providerID, availableProviders, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }

    const info = provider.models[modelID]
    if (!info) {
      const availableModels = Object.keys(provider.models)
      const matches = fuzzysort.go(modelID, availableModels, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }
    return info
  }

  export async function getLanguage(model: Model) {
    const s = await state()
    const key = `${model.providerID}/${model.id}`
    if (s.models.has(key)) return s.models.get(key)!


    if (model.providerID === "anthropic") {
      await ensureAnthropicTokenValid().catch(() => {
        // ignore errors, let plugin handle it
      })
    }

    const provider = s.providers[model.providerID]
    const sdk = await getSDK(model)

    try {
      const language = s.modelLoaders[model.providerID]
        ? await s.modelLoaders[model.providerID](sdk, model.api.id, provider.options)
        : sdk.languageModel(model.api.id)
      s.models.set(key, language)
      return language
    } catch (e) {
      if (e instanceof NoSuchModelError)
        throw new ModelNotFoundError(
          {
            modelID: model.id,
            providerID: model.providerID,
          },
          { cause: e },
        )
      throw e
    }
  }

  export async function closest(providerID: string, query: string[]) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) return undefined
    for (const item of query) {
      for (const modelID of Object.keys(provider.models)) {
        if (modelID.includes(item))
          return {
            providerID,
            modelID,
          }
      }
    }
  }

  export async function getSmallModel(providerID: string) {
    const cfg = await Config.get()

    if (cfg.small_model) {
      const parsed = parseModel(cfg.small_model)
      return getModel(parsed.providerID, parsed.modelID)
    }

    const provider = await state().then((state) => state.providers[providerID])
    if (provider) {
      let priority = [
        "gpt-5-mini",
        "claude-haiku-4-5",
        "claude-haiku-4.5",
        "3-5-haiku",
        "3.5-haiku",
        "gemini-2.5-flash",
        "gpt-5-nano",
      ]
      // claude-haiku-4.5 is considered a premium model in github copilot, we shouldn't use premium requests for title gen
      if (providerID === "github-copilot") {
        priority = priority.filter((m) => m !== "claude-haiku-4.5")
      }
      if (providerID.startsWith("arctic")) {
        priority = ["gpt-5-nano"]
      }
      for (const item of priority) {
        for (const model of Object.keys(provider.models)) {
          if (model.includes(item)) return getModel(providerID, model)
        }
      }
    }

    // Check if arctic provider is available before using it
    const arcticProvider = await state().then((state) => state.providers["arctic"])
    if (arcticProvider && arcticProvider.models["gpt-5-nano"]) {
      return getModel("arctic", "gpt-5-nano")
    }

    return undefined
  }

  const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
  export function sort(models: Model[]) {
    return sortBy(
      models,
      [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
      [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
      [(model) => model.id, "desc"],
    )
  }

  export async function defaultModel() {
    const cfg = await Config.get()
    if (cfg.model) return parseModel(cfg.model)

    const provider = await list()
      .then((val) => Object.values(val))
      .then((x) => x.find((p) => !cfg.provider || Object.keys(cfg.provider).includes(p.id)))
    if (!provider) throw new Error("no providers found")
    const [model] = sort(Object.values(provider.models))
    if (!model) throw new Error("no models found")
    return {
      providerID: provider.id,
      modelID: model.id,
    }
  }

  export function parseModel(model: string) {
    const [providerPart, ...rest] = model.split("/")
    const parsed = Auth.parseDisplayName(providerPart)
    const providerID = Auth.formatKey(parsed.provider, parsed.connection)
    return {
      providerID,
      modelID: rest.join("/"),
    }
  }

  export const ModelNotFoundError = NamedError.create(
    "ProviderModelNotFoundError",
    z.object({
      providerID: z.string(),
      modelID: z.string(),
      suggestions: z.array(z.string()).optional(),
    }),
  )

  export const InitError = NamedError.create(
    "ProviderInitError",
    z.object({
      providerID: z.string(),
    }),
  )
}
