import type { Hooks } from "@arctic-cli/plugin"
import * as prompts from "@clack/prompts"
import os from "os"
import path from "path"
import { map, pipe, sortBy, values } from "remeda"
import { Auth } from "../../auth"
import { CodexClient } from "../../auth/codex"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { ModelsDev } from "../../provider/models"
import { UI } from "../ui"
import { cmd } from "./cmd"

type PluginAuth = NonNullable<Hooks["auth"]>

/**
 * Check if provider already has credentials BEFORE starting auth flow.
 * Returns whether to proceed with auth and optionally a connection name.
 */
async function checkExistingConnection(provider: string): Promise<{ proceed: boolean; connectionName?: string }> {
  const connections = await Auth.listConnections(provider)

  if (connections.length === 0) {
    return { proceed: true }
  }

  const existingInfo = connections[0].info
  let existingLabel = ""

  if (existingInfo.type === "codex" && existingInfo.email) {
    existingLabel = existingInfo.email
  } else if (existingInfo.type === "oauth") {
    existingLabel = "OAuth"
  } else if (existingInfo.type === "api") {
    existingLabel = "API key"
  } else if (existingInfo.type === "github") {
    existingLabel = "GitHub token"
  }

  prompts.log.warn(`You already have a connection for ${provider}${existingLabel ? ` (${existingLabel})` : ""}`)

  const addAnother = await prompts.confirm({
    message: "Do you want to add another connection?",
    initialValue: true,
  })

  if (prompts.isCancel(addAnother)) return { proceed: false }

  if (!addAnother) {
    const overwrite = await prompts.confirm({
      message: "Do you want to overwrite the existing connection?",
      initialValue: false,
    })

    if (prompts.isCancel(overwrite)) return { proceed: false }

    if (!overwrite) {
      return { proceed: false }
    }

    return { proceed: true }
  }

  const connectionName = await prompts.text({
    message: "Name for this connection",
    placeholder: "mycompany",
    validate: (value) => {
      if (!value) return "Connection name is required"
      return Auth.validateConnectionName(value)
    },
  })

  if (prompts.isCancel(connectionName)) return { proceed: false }

  return { proceed: true, connectionName }
}

/**
 * Handle plugin-based authentication flow.
 * Returns true if auth was handled, false if it should fall through to default handling.
 */
async function handlePluginAuth(plugin: { auth: PluginAuth }, provider: string): Promise<boolean> {
  const check = await checkExistingConnection(provider)
  if (!check.proceed) {
    prompts.outro("Cancelled")
    return true
  }

  let index = 0
  if (plugin.auth.methods.length > 1) {
    const method = await prompts.select({
      message: "Login method",
      options: [
        ...plugin.auth.methods.map((x, index) => ({
          label: x.label,
          value: index.toString(),
        })),
      ],
    })
    if (prompts.isCancel(method)) throw new UI.CancelledError()
    index = parseInt(method)
  }
  const method = plugin.auth.methods[index]

  // Handle prompts for all auth types
  await new Promise((resolve) => setTimeout(resolve, 10))
  const inputs: Record<string, string> = {}
  if (method.prompts) {
    for (const prompt of method.prompts) {
      if (prompt.condition && !prompt.condition(inputs)) {
        continue
      }
      if (prompt.type === "select") {
        const value = await prompts.select({
          message: prompt.message,
          options: prompt.options,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      } else {
        const value = await prompts.text({
          message: prompt.message,
          placeholder: prompt.placeholder,
          validate: prompt.validate ? (v) => prompt.validate!(v ?? "") : undefined,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      }
    }
  }

  if (method.type === "oauth") {
    const authorize = await method.authorize(inputs)

    const persistAuthResult = async (result: Awaited<ReturnType<typeof authorize.callback>>) => {
      if (!result || result.type !== "success") return
      const saveProvider = result.provider ?? provider

      let authInfo: Auth.Info
      if ("refresh" in result) {
        if ("idToken" in result && result.idToken) {
          authInfo = {
            type: "codex",
            accessToken: result.access,
            refreshToken: result.refresh,
            expiresAt: result.expires,
            idToken: result.idToken,
            accountId: result.accountId,
            email: result.email,
            planType: result.planType,
          }
        } else {
          authInfo = {
            type: "oauth",
            refresh: result.refresh,
            access: result.access,
            expires: result.expires,
          }
        }
      } else if ("key" in result) {
        authInfo = {
          type: "api",
          key: result.key,
        }
      } else {
        return
      }

      const authKey = check.connectionName ? Auth.formatKey(saveProvider, check.connectionName) : saveProvider
      await Auth.set(authKey, authInfo)
    }

    if (authorize.url) {
      // Use console.log directly because @clack/prompts strips escape sequences
      console.log("│")
      console.log("●  Go to: " + UI.hyperlink(authorize.url))
    }

    if (authorize.method === "auto") {
      if (authorize.instructions) {
        // Use console.log directly to preserve hyperlinks in instructions
        console.log("│")
        console.log("●  " + authorize.instructions)
      }
      const spinner = prompts.spinner()
      spinner.start("Waiting for authorization...")
      const result = await authorize.callback()
      if (result.type === "failed") {
        spinner.stop("Failed to authorize", 1)
      }
      if (result.type === "success") {
        await persistAuthResult(result)
        spinner.stop("Login successful")
      }
    }

    if (authorize.method === "code") {
      const code = await prompts.text({
        message: "Paste the authorization code here: ",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(code)) throw new UI.CancelledError()
      const result = await authorize.callback(code)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
      }
      if (result.type === "success") {
        await persistAuthResult(result)
        prompts.log.success("Login successful")
      }
    }

    prompts.outro("Done")
    return true
  }

  if (method.type === "api") {
    if (method.authorize) {
      const result = await method.authorize(inputs)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        const authInfo: Auth.Info = {
          type: "api",
          key: result.key,
        }
        const authKey = check.connectionName ? Auth.formatKey(saveProvider, check.connectionName) : saveProvider
        await Auth.set(authKey, authInfo)
        prompts.log.success("Login successful")
      }
      prompts.outro("Done")
      return true
    }
  }

  return false
}

async function handleCodexDeviceLogin() {
  const check = await checkExistingConnection("codex")
  if (!check.proceed) {
    prompts.outro("Cancelled")
    return
  }

  prompts.log.info("Authorize Codex with your ChatGPT subscription via device login.")
  try {
    await CodexClient.login()

    const codexAuth = await Auth.get("codex")
    if (codexAuth) {
      const authKey = check.connectionName ? Auth.formatKey("codex", check.connectionName) : "codex"
      if (authKey !== "codex") {
        await Auth.set(authKey, codexAuth)
        await Auth.remove("codex")
      }
    }

    prompts.log.success("Codex login successful")
    prompts.outro("Done")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    prompts.log.error(`Codex login failed: ${message}`)
    throw error
  }
}

interface OllamaModel {
  id: string
  object: string
  created: number
  owned_by: string
}

interface OllamaModelsResponse {
  object: string
  data: OllamaModel[]
}

async function handleOllamaLogin() {
  const check = await checkExistingConnection("ollama")
  if (!check.proceed) {
    prompts.outro("Cancelled")
    return
  }

  prompts.log.info("Connect to a local Ollama instance.")

  const host = await prompts.text({
    message: "Ollama host",
    placeholder: "127.0.0.1",
    defaultValue: "127.0.0.1",
  })
  if (prompts.isCancel(host)) throw new UI.CancelledError()

  const portInput = await prompts.text({
    message: "Ollama port",
    placeholder: "11434",
    defaultValue: "11434",
    validate: (x) => {
      if (!x) return undefined
      const port = parseInt(x, 10)
      if (isNaN(port) || port < 1 || port > 65535) return "Invalid port number"
      return undefined
    },
  })
  if (prompts.isCancel(portInput)) throw new UI.CancelledError()

  const hostValue = host || "127.0.0.1"
  const port = parseInt(portInput || "11434", 10)
  const baseUrl = `http://${hostValue}:${port}`

  const spinner = prompts.spinner()
  spinner.start("Connecting to Ollama...")

  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      spinner.stop("Failed to connect to Ollama", 1)
      prompts.log.error(`HTTP ${response.status}: ${response.statusText}`)
      return
    }

    const data = (await response.json()) as OllamaModelsResponse

    if (!data.data || data.data.length === 0) {
      spinner.stop("Connected but no models found", 1)
      prompts.log.warn("No models available. Pull a model with: ollama pull <model>")
      return
    }

    spinner.stop("Connected to Ollama")

    prompts.log.info(`Found ${data.data.length} model${data.data.length === 1 ? "" : "s"}:`)
    for (const model of data.data) {
      prompts.log.message(`  ${model.id} ${UI.Style.TEXT_DIM}(${model.owned_by})`)
    }

    const authInfo: Auth.Info = {
      type: "ollama",
      host: hostValue,
      port,
    }
    const authKey = check.connectionName ? Auth.formatKey("ollama", check.connectionName) : "ollama"
    await Auth.set(authKey, authInfo)

    prompts.log.success("Ollama configured successfully")
    prompts.outro("Done")
  } catch (error) {
    spinner.stop("Failed to connect to Ollama", 1)
    const message = error instanceof Error ? error.message : String(error)
    prompts.log.error(`Connection failed: ${message}`)
    prompts.log.info("Make sure Ollama is running: ollama serve")
  }
}

async function handleAlibabaLogin() {
  const check = await checkExistingConnection("alibaba")
  if (!check.proceed) {
    prompts.outro("Cancelled")
    return
  }

  prompts.log.info("Authorize Alibaba (Qwen Code) with your Qwen account via device login.")

  const { ArcticQwenAuth } = await import("../../auth/qwen-oauth")
  const plugin = await ArcticQwenAuth({} as any)

  if (!plugin.auth) {
    throw new Error("Qwen auth plugin failed to initialize")
  }

  const oauthMethod = plugin.auth.methods.find((m) => m.type === "oauth")
  if (!oauthMethod || !oauthMethod.authorize) {
    throw new Error("Qwen OAuth method not found")
  }

  const authorize = await oauthMethod.authorize()

  if (authorize.instructions) {
    prompts.log.info(authorize.instructions)
  }

  if (authorize.method === "auto" && authorize.callback) {
    const spinner = prompts.spinner()
    spinner.start("Waiting for authorization...")
    const result = await authorize.callback()
    if (result.type === "failed") {
      spinner.stop("Failed to authorize", 1)
    }
    if (result.type === "success") {
      spinner.stop("Login successful")

      const alibabaAuth = await Auth.get("alibaba")
      if (alibabaAuth) {
        const authKey = check.connectionName ? Auth.formatKey("alibaba", check.connectionName) : "alibaba"
        if (authKey !== "alibaba") {
          await Auth.set(authKey, alibabaAuth)
          await Auth.remove("alibaba")
        }
      }
    }
  }

  prompts.outro("Done")
}

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs.command(AuthLoginCommand).command(AuthLogoutCommand).command(AuthListCommand).demandCommand(),
  async handler() {},
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  async handler() {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = Object.entries(await Auth.all())
    const database = await ModelsDev.get()

    const grouped = new Map<string, Array<{ key: string; connection?: string; info: Auth.Info }>>()

    for (const [key, info] of results) {
      const parsed = Auth.parseKey(key)
      if (!grouped.has(parsed.provider)) {
        grouped.set(parsed.provider, [])
      }
      grouped.get(parsed.provider)!.push({ key, connection: parsed.connection, info })
    }

    for (const [provider, connections] of Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      const providerName = database[provider]?.name || provider

      if (connections.length === 1 && !connections[0].connection) {
        let label = ""
        const info = connections[0].info
        if (info.type === "codex" && info.email) {
          label = info.email
        } else if (info.type === "oauth") {
          label = "OAuth"
        } else if (info.type === "api") {
          label = "API key"
        } else if (info.type === "github") {
          label = "GitHub token"
        } else {
          label = info.type
        }
        prompts.log.info(`${providerName}${label ? ` ${UI.Style.TEXT_DIM}(${label})` : ""}`)
      } else {
        const defaultConn = connections.find((c) => !c.connection)
        if (defaultConn) {
          let label = ""
          if (defaultConn.info.type === "codex" && defaultConn.info.email) {
            label = defaultConn.info.email
          } else {
            label = defaultConn.info.type
          }
          prompts.log.info(`${providerName}`)
          prompts.log.message(`  └─ ${label} ${UI.Style.TEXT_DIM}(default)`)
        }

        for (const conn of connections.filter((c) => c.connection)) {
          let label = ""
          if (conn.info.type === "codex" && conn.info.email) {
            label = conn.info.email
          } else {
            label = conn.info.type
          }

          if (!defaultConn) {
            prompts.log.info(`${providerName} (${conn.connection})`)
            prompts.log.message(`  └─ ${label}`)
          } else {
            prompts.log.message(`  └─ ${label} ${UI.Style.TEXT_DIM}(${conn.connection})`)
          }
        }
      }
    }

    prompts.outro(`${results.length} credential${results.length === 1 ? "" : "s"}`)

    // Environment variables section
    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) {
          activeEnvVars.push({
            provider: provider.name || providerID,
            envVar,
          })
        }
      }
    }

    if (activeEnvVars.length > 0) {
      UI.empty()
      prompts.intro("Environment")

      for (const { provider, envVar } of activeEnvVars) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }
  },
})

export const AuthLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "arctic auth provider",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add credential")

        await ModelsDev.refresh().catch(() => {})
        const config = await Config.get()
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const providers = await ModelsDev.get().then((x) => {
          const filtered: Record<string, (typeof x)[string]> = {}
          for (const [key, value] of Object.entries(x)) {
            if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
              filtered[key] = value
            }
          }
          return filtered
        })

        providers["codex"] = {
          id: "codex",
          name: "Codex",
          env: [],
          models: {},
        }
        providers["antigravity"] = {
          id: "antigravity",
          name: "Antigravity",
          env: [],
          models: {},
        }
        providers["ollama"] = {
          id: "ollama",
          name: "Ollama",
          env: [],
          models: {},
        }
        providers["alibaba"] = {
          id: "alibaba",
          name: "Alibaba (Qwen Code)",
          env: [],
          models: {},
        }
        providers["minimax-coding-plan"] = {
          id: "minimax-coding-plan",
          name: "MiniMax Coding Plan",
          env: [],
          models: {},
        }

        let provider = args.url

        // If args.url is provided but not a known provider, treat it as a URL
        if (provider && !providers[provider]) {
          const wellknown = await fetch(`${args.url}/.well-known/arctic`)
            .then((x) => x.json() as any)
            .catch(() => undefined)
          if (wellknown) {
            prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
            const proc = Bun.spawn({
              cmd: wellknown.auth.command,
              stdout: "pipe",
            })
            const exit = await proc.exited
            if (exit !== 0) {
              prompts.log.error("Failed")
              prompts.outro("Done")
              return
            }
            const token = await new Response(proc.stdout).text()
            await Auth.set(args.url!, {
              type: "wellknown",
              key: wellknown.auth.env,
              token: token.trim(),
            })
            prompts.log.success("Logged into " + args.url)
            prompts.outro("Done")
            return
          }
        }

        if (!provider) {
          const priority: Record<string, number> = {
            arctic: 0,
            anthropic: 1,
            "github-copilot": 2,
            openai: 3,
            google: 4,
            antigravity: 5,
            openrouter: 5,
            "minimax-coding-plan": 6,
            ollama: 7,
            vercel: 6,
            alibaba: 8,
          }
          const selected = await prompts.autocomplete({
            message: "Select provider",
            maxItems: 8,
            options: [
              ...pipe(
                providers,
                values(),
                sortBy(
                  (x) => priority[x.id] ?? 99,
                  (x) => x.name ?? x.id,
                ),
                map((x) => ({
                  label: x.name,
                  value: x.id,
                  hint: {
                    arctic: "recommended",
                    anthropic: "Claude Max or API key",
                    "github-copilot": "usage tracking",
                    ollama: "local models",
                    "minimax-coding-plan": "OpenAI-compatible",
                  }[x.id],
                })),
              ),
              {
                value: "other",
                label: "Other",
              },
            ],
          })

          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          provider = selected as string
        }

        const plugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider!)
          if (handled) return
        }

        if (provider === "other") {
          const input = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })
          if (prompts.isCancel(input)) throw new UI.CancelledError()
          provider = input.replace(/^@ai-sdk\//, "")
          if (prompts.isCancel(provider)) throw new UI.CancelledError()

          // Check if a plugin provides auth for this custom provider
          const customPlugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
          if (customPlugin && customPlugin.auth) {
            const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider)
            if (handled) return
          }

          prompts.log.warn(
            `This only stores a credential for ${provider} - you will need configure it in arctic.json, check the docs for examples.`,
          )
        }

        if (provider === "amazon-bedrock") {
          prompts.log.info(
            "Amazon bedrock can be configured with standard AWS environment variables like AWS_BEARER_TOKEN_BEDROCK, AWS_PROFILE or AWS_ACCESS_KEY_ID",
          )
          prompts.outro("Done")
          return
        }

        if (provider === "codex") {
          await handleCodexDeviceLogin()
          return
        }

        if (provider === "antigravity") {
          const check = await checkExistingConnection("antigravity")
          if (!check.proceed) {
            prompts.outro("Cancelled")
            return
          }
          await import("../../auth/antigravity-oauth/cli").then((m) => m.handleAntigravityLogin(check.connectionName))
          return
        }

        if (provider === "ollama") {
          await handleOllamaLogin()
          return
        }

        if (provider === "alibaba") {
          await handleAlibabaLogin()
          return
        }

        const check = await checkExistingConnection(provider!)
        if (!check.proceed) {
          prompts.outro("Cancelled")
          return
        }

        if (provider === "vercel") {
          prompts.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
        }

        if (provider === "github-copilot") {
          prompts.log.info("Create a personal access token at https://github.com/settings/tokens")
          prompts.log.info("Required scope: copilot (for usage tracking)")
        }

        const key = await prompts.password({
          message: provider === "github-copilot" ? "Enter your GitHub token" : "Enter your API key",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()

        let authInfo: Auth.Info
        if (provider === "github-copilot") {
          authInfo = {
            type: "github",
            token: key,
          }
        } else {
          authInfo = {
            type: "api",
            key,
          }
        }

        const authKey = check.connectionName ? Auth.formatKey(provider!, check.connectionName) : provider!
        await Auth.set(authKey, authInfo)

        prompts.log.success("Logged into " + provider)
        prompts.outro("Done")
      },
    })
  },
})

export const AuthLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  async handler() {
    UI.empty()
    const credentials = await Auth.all().then((x) => Object.entries(x))
    prompts.intro("Remove credential")
    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      return
    }
    const database = await ModelsDev.get()
    const providerID = await prompts.select({
      message: "Select connection",
      options: credentials.map(([key, value]) => {
        const parsed = Auth.parseKey(key)
        const providerName = database[parsed.provider]?.name || parsed.provider
        const displayName = Auth.formatDisplayName(providerName, parsed.connection)

        let label = displayName
        if (value.type === "codex" && value.email) {
          label += ` ${UI.Style.TEXT_DIM}(${value.email})`
        } else {
          label += ` ${UI.Style.TEXT_DIM}(${value.type})`
        }

        return {
          label,
          value: key,
        }
      }),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()
    await Auth.remove(providerID)
    prompts.outro("Logout successful")
  },
})
