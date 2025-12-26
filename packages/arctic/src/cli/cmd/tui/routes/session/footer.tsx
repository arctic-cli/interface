import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { useKeybind } from "../../context/keybind"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const keybind = useKeybind()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const session = createMemo(() => {
    if (route.data.type !== "session") return undefined
    return sync.session.get(route.data.sessionID)
  })
  const benchmarkLabel = createMemo(() => {
    const current = session()
    if (!current?.benchmark) return undefined
    const parent =
      current.benchmark.type === "parent" ? current : sync.session.get(current.benchmark.parentID)
    if (parent?.benchmark?.type !== "parent") return undefined
    const children = parent.benchmark.children
    if (!children.length) return "Benchmark: 0 slots"
    const index = children.findIndex((child) => child.sessionID === current.id)
    if (index === -1) return `Benchmark: parent (${children.length} slots)`
    const model = children[index].model
    const isApplied = parent.benchmark.appliedSessionID === current.id
    return `Benchmark: ${model.providerID}/${model.modelID} (slot ${index + 1}/${children.length})${isApplied ? " (Applied)" : ""}`
  })
  const benchmarkSwitchHint = createMemo(() => {
    const current = session()
    if (!current?.benchmark) return undefined
    const parent =
      current.benchmark.type === "parent" ? current : sync.session.get(current.benchmark.parentID)
    if (parent?.benchmark?.type !== "parent") return undefined
    if (parent.benchmark.children.length <= 1) return undefined
    return `Switch ${keybind.print("benchmark_prev")} / ${keybind.print("benchmark_next")}`
  })
  const directory = useDirectory()
  const connected = useConnected()

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeout = setTimeout(() => tick(), 5000)
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeout = setTimeout(() => tick(), 10_000)
        return
      }
    }
    let timeout = setTimeout(() => tick(), 10_000)

    onCleanup(() => {
      clearTimeout(timeout)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>◉</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <Show when={benchmarkLabel()}>
              {(label) => <text fg={theme.text}>{label()}</text>}
            </Show>
            <Show when={benchmarkSwitchHint()}>
              {(hint) => <text fg={theme.textMuted}>{hint()}</text>}
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: theme.success }}>•</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
