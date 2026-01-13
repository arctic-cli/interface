import { createMemo, createSignal, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Keybind } from "@/util/keybind"
import { useSDK } from "@tui/context/sdk"
import { Auth } from "@/auth"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"

type ConnectionOption = {
  providerID: string
  baseProvider: string
  connectionName: string
  displayName: string
  authLabel: string
}

async function getConnectionLabel(providerID: string): Promise<string> {
  const info = await Auth.get(providerID)
  if (!info) return "Unknown"
  if (info.type === "codex" && info.email) return info.email
  if (info.type === "oauth") return "OAuth"
  if (info.type === "api") return "API key"
  if (info.type === "github") return "GitHub token"
  if (info.type === "ollama") return `${info.host}:${info.port}`
  return "Authenticated"
}

export function DialogConnections() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [, setRef] = createSignal<DialogSelectRef<ConnectionOption>>()
  const [connections, setConnections] = createSignal<ConnectionOption[]>([])

  onMount(async () => {
    const providers = sync.data.provider ?? []
    const connectionList: ConnectionOption[] = []

    for (const provider of providers) {
      const parsed = Auth.parseKey(provider.id)
      if (!parsed.connection) continue

      const authLabel = await getConnectionLabel(provider.id)

      connectionList.push({
        providerID: provider.id,
        baseProvider: parsed.provider,
        connectionName: parsed.connection,
        displayName: Auth.formatDisplayName(parsed.provider, parsed.connection),
        authLabel,
      })
    }

    setConnections(connectionList)
  })

  const options = createMemo(() => {
    const sorted = connections().sort((a, b) => {
      if (a.baseProvider !== b.baseProvider) {
        return a.baseProvider.localeCompare(b.baseProvider)
      }
      return a.connectionName.localeCompare(b.connectionName)
    })

    return sorted.map((conn) => ({
      value: conn,
      title: conn.displayName,
      description: conn.authLabel,
      category: conn.baseProvider,
    }))
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("d")[0],
      title: "delete",
      onTrigger: async (option: DialogSelectOption<ConnectionOption>) => {
        const conn = option.value
        const confirmed = await DialogConfirm.show(
          dialog,
          `Delete connection "${conn.displayName}"?`,
          "This will remove the authentication and cannot be undone.",
        )

        if (!confirmed) return

        await Auth.remove(conn.providerID)
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        toast.show({ message: `Deleted ${conn.displayName}`, variant: "success" })

        const remainingConnections = connections().filter((c) => c.providerID !== conn.providerID)
        setConnections(remainingConnections)

        if (remainingConnections.length === 0) {
          dialog.clear()
        }
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title="Manage Connections"
      options={options()}
      keybind={keybinds()}
      onSelect={() => {}}
    />
  )
}
