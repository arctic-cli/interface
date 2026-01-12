import { openBrowserUrl } from "@/auth/codex-oauth/auth/browser"
import type { ProviderAuthAuthorization } from "@arctic-cli/sdk/v2"
import { TextAttributes } from "@opentui/core"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { map, pipe, sortBy } from "remeda"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogModel } from "./dialog-model"

const PROVIDER_PRIORITY: Record<string, number> = {
  arctic: 0,
  anthropic: 1,
  "github-copilot": 2,
  openai: 3,
  google: 4,
  antigravity: 5,
  openrouter: 5,
  ollama: 6,
  codex: 7,
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const options = createMemo(() => {
    return pipe(
      sync.data.provider_next.all,
      sortBy((x) => PROVIDER_PRIORITY[x.id] ?? 99),
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        description: {
          anthropic: "(Claude Max or API key)",
          antigravity: "(Gemini 3/Sonnet/Opus 4.5)",
          codex: "(GPT-5 via ChatGPT Plus/Pro)",
          ollama: "(local models)",
        }[provider.id],
        category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
        async onSelect() {
          const methods = sync.data.provider_auth[provider.id] ?? [
            {
              type: "api",
              label: "API key",
            },
          ]
          let index: number | null = 0
          if (methods.length > 1) {
            index = await new Promise<number | null>((resolve) => {
              dialog.replace(
                () => (
                  <DialogSelect
                    title="Select auth method"
                    options={methods.map((x, index) => ({
                      title: x.label,
                      value: index,
                    }))}
                    onSelect={(option) => resolve(option.value)}
                  />
                ),
                () => resolve(null),
              )
            })
          }
          if (index == null) return
          const method = methods[index]
          if (method.type === "oauth") {
            const result = await sdk.client.provider.oauth.authorize({
              providerID: provider.id,
              method: index,
            })
            if (result.data?.method === "code") {
              dialog.replace(() => (
                <CodeMethod providerID={provider.id} title={method.label} index={index} authorization={result.data!} />
              ))
            }
            if (result.data?.method === "auto") {
              dialog.replace(() => (
                <AutoMethod providerID={provider.id} title={method.label} index={index} authorization={result.data!} />
              ))
            }
          }
          if (method.type === "api") {
            // Special case for ollama - use custom connection flow
            if (provider.id === "ollama") {
              return dialog.replace(() => <OllamaMethod providerID={provider.id} title={method.label} />)
            }
            if (provider.id === "minimax-coding-plan" || provider.id === "minimax") {
              return dialog.replace(() => <MinimaxMethod providerID={provider.id} title={method.label} />)
            }
            return dialog.replace(() => <ApiMethod providerID={provider.id} title={method.label} />)
          }
        },
      })),
    )
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  return <DialogSelect title="Connect a provider" options={options()} />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      dialog.clear()
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box gap={1}>
        <text fg={theme.primary} onMouseUp={() => openBrowserUrl(props.authorization.url)}>
          {props.authorization.url}
        </text>

        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (!error) {
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <text fg={theme.primary} onMouseUp={() => openBrowserUrl(props.authorization.url)}>
            {props.authorization.url}
          </text>

          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={undefined}
      onConfirm={async (value) => {
        if (!value) return
        sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}

interface OllamaMethodProps {
  providerID: string
  title: string
}
function OllamaMethod(props: OllamaMethodProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title="Ollama host"
      placeholder="127.0.0.1"
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>Connect to a local Ollama instance</text>
        </box>
      )}
      onConfirm={(value) => {
        const host = value || "127.0.0.1"
        dialog.replace(() => <OllamaPortStep host={host} />)
      }}
    />
  )
}

interface OllamaPortStepProps {
  host: string
}
function OllamaPortStep(props: OllamaPortStepProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [error, setError] = createSignal<string | undefined>()

  return (
    <DialogPrompt
      title="Ollama port"
      placeholder="11434"
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>Host: {props.host}</text>
          <Show when={error()}>
            <text fg={theme.error}>{error()}</text>
          </Show>
        </box>
      )}
      onConfirm={async (value) => {
        const portValue = value || "11434"
        const portNum = parseInt(portValue, 10)
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
          setError("Invalid port number")
          return
        }
        dialog.replace(() => <OllamaConnectingStep host={props.host} port={portNum} />)
      }}
    />
  )
}

interface OllamaConnectingStepProps {
  host: string
  port: number
}
function OllamaConnectingStep(props: OllamaConnectingStepProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()
  const [error, setError] = createSignal<string | undefined>()
  const [connecting, setConnecting] = createSignal(true)

  onMount(async () => {
    const baseUrl = `http://${props.host}:${props.port}`

    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        setError(`HTTP ${response.status}: ${response.statusText}`)
        setConnecting(false)
        return
      }

      const data = (await response.json()) as { data?: Array<{ id: string }> }

      if (!data.data || data.data.length === 0) {
        setError("No models found. Pull a model with: ollama pull <model>")
        setConnecting(false)
        return
      }

      // Save the ollama config
      await sdk.client.auth.set({
        providerID: "ollama",
        auth: {
          type: "ollama",
          host: props.host,
          port: props.port,
        } as any,
      })

      await sdk.client.instance.dispose()
      await sync.bootstrap()
      dialog.replace(() => <DialogModel providerID="ollama" />)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(`Connection failed: ${message}`)
      setConnecting(false)
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {connecting() ? "Connecting to Ollama" : "Connection Failed"}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <text fg={theme.textMuted}>
        {props.host}:{props.port}
      </text>
      <Show when={connecting()}>
        <text fg={theme.primary}>Connecting...</text>
      </Show>
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
        <text fg={theme.textMuted}>Press esc to go back</text>
      </Show>
    </box>
  )
}

interface MinimaxMethodProps {
  providerID: string
  title: string
}
function MinimaxMethod(props: MinimaxMethodProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>Enter your MiniMax API key</text>
        </box>
      )}
      onConfirm={(value) => {
        if (!value) return
        dialog.replace(() => <MinimaxGroupIdStep providerID={props.providerID} apiKey={value} />)
      }}
    />
  )
}

interface MinimaxGroupIdStepProps {
  providerID: string
  apiKey: string
}
function MinimaxGroupIdStep(props: MinimaxGroupIdStepProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title="Group ID (Optional)"
      placeholder="Leave empty to skip"
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>Optional: Enter your Group ID to enable usage tracking.</text>
          <text fg={theme.textMuted}>Find it at: https://platform.minimax.io/user-center/basic-information</text>
        </box>
      )}
      onConfirm={async (groupId) => {
        const auth: any = {
          type: "api",
          key: props.apiKey,
        }
        if (groupId && groupId.trim()) {
          auth.groupId = groupId.trim()
        }
        await sdk.client.auth.set({
          providerID: props.providerID,
          auth,
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}
