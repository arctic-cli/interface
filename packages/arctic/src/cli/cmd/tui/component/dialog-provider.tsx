import { Auth } from "@/auth"
import { openBrowserUrl } from "@/auth/codex-oauth/auth/browser"
import type { ProviderAuthAuthorization } from "@arctic-cli/sdk/v2"
import { TextAttributes } from "@opentui/core"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { filter, map, pipe, sortBy } from "remeda"
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

/**
 * get label for existing connection (email, oauth, api key, etc)
 */
function getConnectionLabel(info: Auth.Info): string {
  if (info.type === "codex" && info.email) return info.email
  if (info.type === "oauth") return "OAuth"
  if (info.type === "api") return "API key"
  if (info.type === "github") return "GitHub token"
  if (info.type === "ollama") return `${info.host}:${info.port}`
  return "Authenticated"
}

/**
 * check for existing connection and show dialog if needed
 * calls onContinue with connectionName if user wants to proceed
 */
async function checkExistingConnection(
  providerID: string,
  dialog: ReturnType<typeof useDialog>,
  onContinue: (connectionName?: string) => void | Promise<void>,
): Promise<void> {
  const connections = await Auth.listConnections(providerID)

  if (connections.length === 0) {
    await onContinue()
    return
  }

  const existingLabel = getConnectionLabel(connections[0].info)

  dialog.replace(() => (
    <ExistingConnectionDialog providerID={providerID} existingLabel={existingLabel} onContinue={onContinue} />
  ))
}

interface ExistingConnectionDialogProps {
  providerID: string
  existingLabel: string
  onContinue: (connectionName?: string) => void | Promise<void>
}

function ExistingConnectionDialog(props: ExistingConnectionDialogProps) {
  const dialog = useDialog()

  const options = createMemo(() => [
    {
      title: "Add another account",
      description: "Connect a second account for this provider",
      value: "add",
      onSelect: async () => {
        dialog.replace(() => (
          <ConnectionNamePrompt providerID={props.providerID} onConfirm={async (name) => await props.onContinue(name)} />
        ))
      },
    },
    {
      title: "Overwrite existing",
      description: "Replace the current connection",
      value: "overwrite",
      onSelect: async () => {
        dialog.replace(() => (
          <DialogSelect
            title="Overwrite existing connection?"
            options={[
              {
                title: "Yes, overwrite",
                value: "yes",
                onSelect: async () => await props.onContinue(),
              },
              {
                title: "No, cancel",
                value: "no",
                onSelect: () => dialog.clear(),
              },
            ]}
          />
        ))
      },
    },
    {
      title: "Cancel",
      value: "cancel",
      onSelect: () => dialog.clear(),
    },
  ])

  return <DialogSelect title={`Already connected to ${props.providerID} (${props.existingLabel})`} options={options()} />
}

interface ConnectionNamePromptProps {
  providerID: string
  onConfirm: (name: string) => void | Promise<void>
}

function ConnectionNamePrompt(props: ConnectionNamePromptProps) {
  const { theme } = useTheme()
  const [error, setError] = createSignal<string>()

  return (
    <DialogPrompt
      title="Name this connection"
      placeholder="work, personal, mycompany..."
      description={() => (
        <Show when={error()} fallback={
          <text fg={theme.textMuted}>
            Give this account a unique name to identify it later
          </text>
        }>
          <text fg={theme.error}>{error()}</text>
        </Show>
      )}
      onConfirm={async (value) => {
        if (!value) {
          setError("Connection name is required")
          return
        }
        const validation = Auth.validateConnectionName(value)
        if (typeof validation === "string") {
          setError(validation)
          return
        }
        await props.onConfirm(value)
      }}
    />
  )
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const options = createMemo(() => {
    return pipe(
      sync.data.provider_next.all,
      // filter out connection providers (those with : in the id)
      filter((provider) => !provider.id.includes(":")),
      sortBy((x) => PROVIDER_PRIORITY[x.id] ?? 99),
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        description: {
          anthropic: "Claude Max or API key",
          antigravity: "Gemini 3/Sonnet/Opus 4.5",
          codex: "GPT-5 via ChatGPT Plus/Pro",
          ollama: "local models",
        }[provider.id],
        category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
        async onSelect() {
          // define the auth flow as a function that can be called with optional connectionName
          const startAuthFlow = async (connectionName?: string) => {
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
              const targetProviderID = connectionName ? Auth.formatKey(provider.id, connectionName) : provider.id
              const result = await sdk.client.provider.oauth.authorize({
                providerID: targetProviderID,
                method: index,
              })
              if (result.data?.method === "code") {
                dialog.replace(() => (
                  <CodeMethod
                    providerID={targetProviderID}
                    title={method.label}
                    index={index}
                    authorization={result.data!}
                  />
                ))
              }
              if (result.data?.method === "auto") {
                dialog.replace(() => (
                  <AutoMethod
                    providerID={targetProviderID}
                    title={method.label}
                    index={index}
                    authorization={result.data!}
                  />
                ))
              }
            }
            if (method.type === "api") {
              if (provider.id === "ollama") {
                return dialog.replace(() => (
                  <OllamaMethod providerID={provider.id} title={method.label} connectionName={connectionName} />
                ))
              }
              if (provider.id === "minimax-coding-plan" || provider.id === "minimax") {
                return dialog.replace(() => (
                  <MinimaxMethod providerID={provider.id} title={method.label} connectionName={connectionName} />
                ))
              }
              return dialog.replace(() => (
                <ApiMethod providerID={provider.id} title={method.label} connectionName={connectionName} />
              ))
            }
          }

          // check for existing connections first
          await checkExistingConnection(provider.id, dialog, startAuthFlow)
        },
      })),
    )
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  const { theme } = useTheme()
  return (
    <box flexDirection="column" gap={0}>
      <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
        <text fg={theme.textMuted}>
          All providers support multiple accounts. Add as many as you need.
        </text>
      </box>
      <DialogSelect title="Connect a provider" options={options()} />
    </box>
  )
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
  connectionName?: string
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
        const targetKey = props.connectionName
          ? Auth.formatKey(props.providerID, props.connectionName)
          : props.providerID
        await sdk.client.auth.set({
          providerID: targetKey,
          auth: {
            type: "api",
            key: value,
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={targetKey} />)
      }}
    />
  )
}

interface OllamaMethodProps {
  providerID: string
  title: string
  connectionName?: string
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
        dialog.replace(() => <OllamaPortStep host={host} connectionName={props.connectionName} />)
      }}
    />
  )
}

interface OllamaPortStepProps {
  host: string
  connectionName?: string
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
        dialog.replace(() => (
          <OllamaConnectingStep host={props.host} port={portNum} connectionName={props.connectionName} />
        ))
      }}
    />
  )
}

interface OllamaConnectingStepProps {
  host: string
  port: number
  connectionName?: string
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

      const targetKey = props.connectionName ? Auth.formatKey("ollama", props.connectionName) : "ollama"

      // Save the ollama config
      await sdk.client.auth.set({
        providerID: targetKey,
        auth: {
          type: "ollama",
          host: props.host,
          port: props.port,
        } as any,
      })

      await sdk.client.instance.dispose()
      await sync.bootstrap()
      dialog.replace(() => <DialogModel providerID={targetKey} />)
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
  connectionName?: string
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
        dialog.replace(() => (
          <MinimaxGroupIdStep providerID={props.providerID} apiKey={value} connectionName={props.connectionName} />
        ))
      }}
    />
  )
}

interface MinimaxGroupIdStepProps {
  providerID: string
  apiKey: string
  connectionName?: string
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
        const targetKey = props.connectionName
          ? Auth.formatKey(props.providerID, props.connectionName)
          : props.providerID
        await sdk.client.auth.set({
          providerID: targetKey,
          auth,
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={targetKey} />)
      }}
    />
  )
}
