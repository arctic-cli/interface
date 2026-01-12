import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match, createEffect, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@arctic-cli/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useKeybind } from "../../context/keybind"
import { useLocal } from "../../context/local"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../component/border"
import { Pricing } from "@/provider/pricing"
import { useToast } from "../../ui/toast"
import { ProviderUsage } from "@/provider/usage"

const USAGE_BAR_SEGMENTS = 16
const USAGE_BAR_FILLED = "█"
const USAGE_BAR_EMPTY = "░"

export function Sidebar(props: { sessionID: string; onHide?: () => void }) {
  const sync = useSync()
  const local = useLocal()
  const sdk = useSDK()
  const { theme } = useTheme()
  const toast = useToast()
  const keybind = useKeybind()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
    todo: true,
    lsp: true,
    benchmark: true,
    usage: true,
  })

  const [usageData, setUsageData] = createSignal<ProviderUsage.Record | null>(null)
  const [usageLoading, setUsageLoading] = createSignal(false)
  const [usageMeta, setUsageMeta] = createSignal<{ providerID: string; fetchedAt: number; errored?: boolean } | null>(
    null,
  )

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))

  const benchmarkParent = createMemo(() => {
    const current = session()
    if (!current?.benchmark) return undefined
    return current.benchmark.type === "parent" ? current : sync.session.get(current.benchmark.parentID)
  })

  const benchmarkChildren = createMemo(() => {
    const parent = benchmarkParent()
    if (parent?.benchmark?.type !== "parent") return []
    return parent.benchmark.children
  })

  const [sessionCost, setSessionCost] = createSignal<number | undefined>(undefined)

  createEffect(() => {
    const msgs = messages()
    let cancelled = false

    let syncTotal = 0
    let syncHasPricing = false
    let needsAsync = false

    for (const msg of msgs) {
      if (msg.role === "assistant" && msg.tokens.output > 0) {
        const assistantMsg = msg as AssistantMessage
        const costBreakdown = Pricing.calculateCost(assistantMsg.modelID, {
          input: assistantMsg.tokens.input,
          output: assistantMsg.tokens.output,
          cacheCreation: assistantMsg.tokens.cache.write,
          cacheRead: assistantMsg.tokens.cache.read,
        })
        if (costBreakdown) {
          syncHasPricing = true
          syncTotal += costBreakdown.totalCost
        } else {
          needsAsync = true
        }
      }
    }

    setSessionCost(syncHasPricing ? syncTotal : undefined)

    if (needsAsync) {
      ;(async () => {
        let total = 0
        let hasPricing = false
        for (const msg of msgs) {
          if (msg.role === "assistant" && msg.tokens.output > 0) {
            const assistantMsg = msg as AssistantMessage
            const costBreakdown = await Pricing.calculateCostAsync(assistantMsg.modelID, {
              input: assistantMsg.tokens.input,
              output: assistantMsg.tokens.output,
              cacheCreation: assistantMsg.tokens.cache.write,
              cacheRead: assistantMsg.tokens.cache.read,
            })
            if (costBreakdown) {
              hasPricing = true
              total += costBreakdown.totalCost
            }
          }
        }

        if (!cancelled) {
          setSessionCost(hasPricing ? total : undefined)
        }
      })().catch(() => {})
    }

    onCleanup(() => {
      cancelled = true
    })
  })

  const cost = createMemo(() => {
    const val = sessionCost()
    if (val === undefined) return "$0.00"
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(val)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "arctic" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )

  const currentProvider = createMemo(() => {
    const benchmark = session()?.benchmark
    const sessionModel = benchmark?.type === "child" ? benchmark.model : undefined
    const model = sessionModel ?? local.model.current()
    return model?.providerID
  })

  const SUPPORTED_USAGE_PROVIDERS = [
    "alibaba",
    "anthropic",
    "@ai-sdk/anthropic",
    "antigravity",
    "codex",
    "github-copilot",
    "google",
    "kimi-for-coding",
    "minimax",
    "minimax-coding-plan",
    "zai-coding-plan",
  ]

  const usageProviderID = createMemo(() => {
    const provider = currentProvider()
    if (provider === "minimax") {
      const hasCodingPlan = sync.data.provider.some((item) => item.id === "minimax-coding-plan")
      return hasCodingPlan ? "minimax-coding-plan" : provider
    }
    return provider
  })

  const showUsageLimits = createMemo(() => {
    const provider = usageProviderID()
    return provider && SUPPORTED_USAGE_PROVIDERS.includes(provider)
  })

  const usageBar = (percent: number | null | undefined) => {
    const safe = Math.max(0, Math.min(100, percent ?? 0))
    const filled = Math.round((safe / 100) * USAGE_BAR_SEGMENTS)
    return `${USAGE_BAR_FILLED.repeat(filled)}${USAGE_BAR_EMPTY.repeat(USAGE_BAR_SEGMENTS - filled)}`
  }

  const usageColor = (remaining: number | null | undefined) => {
    const r = remaining ?? 100
    if (r > 50) return theme.success
    if (r > 20) return theme.warning
    return theme.error
  }

  const formatTimeRemaining = (resetsAt: number | null | undefined) => {
    if (!resetsAt) return ""
    const now = Date.now()
    const resetTime = resetsAt * 1000 // Convert Unix timestamp to milliseconds
    const diff = resetTime - now

    if (diff <= 0) return "resetting soon"

    const totalMinutes = Math.floor(diff / 60000)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    const days = Math.floor(hours / 24)
    const hoursInDay = hours % 24

    if (days > 0) return `${days}d ${hoursInDay}h left`
    if (hours > 0) return `${hours}h ${minutes}m left`
    return `${minutes}m left`
  }

  // Memoize the last completed message time to avoid re-running the effect on every message update
  const lastCompletedMessageTime = createMemo(() => {
    const lastAssistantMessage = messages()
      .filter((m) => m.role === "assistant")
      .findLast((m) => m.time?.completed)
    return lastAssistantMessage?.time?.completed
  })

  // Track session status to only fetch usage when session is idle
  const sessionStatus = createMemo(() => sync.data.session_status[props.sessionID ?? ""])

  createEffect(() => {
    if (!expanded.usage || !showUsageLimits()) return
    const provider = usageProviderID()
    if (!provider || usageLoading()) return

    // Only fetch usage when session is idle (not during active generation)
    const status = sessionStatus()
    if (status?.type === "busy") return

    // Only react to changes in the last completed message time
    const lastCompletedTime = lastCompletedMessageTime()
    const meta = usageMeta()

    if (!sdk.url) return
    if (!lastCompletedTime && !meta) return
    const isSameProvider = meta?.providerID === provider

    // Refresh if:
    // - Provider changed
    // - Data is stale (>60s old)
    // - A new message was completed after our last fetch
    const isStale = meta ? Date.now() - meta.fetchedAt > 60_000 : false
    const hasNewMessage = lastCompletedTime && meta ? lastCompletedTime > meta.fetchedAt : false

    if (isSameProvider && !isStale && !hasNewMessage) return

    setUsageLoading(true)
    const directory = sync.data.path.directory
    const baseUrl = sdk.url
    const providerName = sync.data.provider.find((item) => item.id === provider)?.name ?? provider
    const url = baseUrl ? new URL(`/usage/providers/${encodeURIComponent(provider)}`, baseUrl) : null

    const run = async () => {
      if (!url) {
        throw new Error("Usage server unavailable")
      }
      const res = await fetch(`${url}`, {
        headers: {
          ...(directory ? { "x-arctic-directory": directory } : {}),
          ...(props.sessionID ? { "x-arctic-session-id": props.sessionID } : {}),
          "x-arctic-time-period": "session",
        },
        credentials: "include",
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Request failed (${res.status}): ${body || res.statusText}`)
      }
      return (await res.json()) as ProviderUsage.Record
    }

    run()
      .then((record) => {
        if (record) {
          setUsageData(record)
          setUsageMeta({ providerID: provider, fetchedAt: Date.now(), errored: !!record.error })
        } else {
          setUsageData({
            providerID: provider,
            providerName,
            fetchedAt: Date.now(),
            error: "No usage data returned",
          })
          setUsageMeta({ providerID: provider, fetchedAt: Date.now(), errored: true })
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error("Failed to fetch usage:", err)
        setUsageData({
          providerID: provider,
          providerName,
          fetchedAt: Date.now(),
          error: message,
        })
        setUsageMeta({ providerID: provider, fetchedAt: Date.now(), errored: true })
      })
      .finally(() => {
        setUsageLoading(false)
      })
  })

  return (
    <Show when={session()}>
      <box
        border={["left"]}
        borderColor={theme.border}
        customBorderChars={SplitBorder.customBorderChars}
        width={42}
        minWidth={42}
        maxWidth={42}
        flexBasis={42}
        flexGrow={0}
        flexShrink={0}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
      >
        <scrollbox flexGrow={1}>
          <box flexShrink={0} gap={1} paddingRight={1}>
            <box flexDirection="row" justifyContent="space-between" alignItems="center">
              <text fg={theme.text}>
                <b>{session().title}</b>
              </text>
              <text
                fg={theme.textMuted}
                onMouseDown={() => {
                  if (props.onHide) {
                    props.onHide()
                    toast.show({
                      variant: "info",
                      message: `Press ${keybind.print("sidebar_toggle")} to show sidebar again`,
                      duration: 3000,
                    })
                  }
                }}
              >
                ✕
              </text>
            </box>
            <box>
              <text fg={theme.text}>
                <b>Context</b>
              </text>
              <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
              <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
              <text fg={theme.textMuted}>{cost()} spent</text>
            </box>
            <Show when={benchmarkChildren().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => benchmarkChildren().length > 2 && setExpanded("benchmark", !expanded.benchmark)}
                >
                  <Show when={benchmarkChildren().length > 2}>
                    <text fg={theme.text}>{expanded.benchmark ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Benchmark</b>
                  </text>
                </box>
                <Show when={benchmarkChildren().length <= 2 || expanded.benchmark}>
                  <For each={benchmarkChildren()}>
                    {(child, i) => {
                      const isCurrent = child.sessionID === props.sessionID
                      const isApplied = (() => {
                        const p = benchmarkParent()
                        if (p?.benchmark?.type !== "parent") return false
                        return p.benchmark.appliedSessionID === child.sessionID
                      })()
                      return (
                        <box flexDirection="row" gap={1}>
                          <text
                            flexShrink={0}
                            style={{
                              fg: isApplied ? theme.success : theme.textMuted,
                            }}
                          >
                            {isApplied ? "✓" : "•"}
                          </text>
                          <text fg={isCurrent ? theme.text : theme.textMuted}>
                            {isCurrent ? (
                              <b>
                                Slot {i() + 1}: {child.model.modelID}
                              </b>
                            ) : (
                              `Slot ${i() + 1}: ${child.model.modelID}`
                            )}
                          </text>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={mcpEntries().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => mcpEntries().length > 2 && setExpanded("mcp", !expanded.mcp)}
                >
                  <Show when={mcpEntries().length > 2}>
                    <text fg={theme.text}>{expanded.mcp ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>MCP</b>
                  </text>
                </box>
                <Show when={mcpEntries().length <= 2 || expanded.mcp}>
                  <For each={mcpEntries()}>
                    {([key, item]) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg: (
                              {
                                connected: theme.success,
                                failed: theme.error,
                                disabled: theme.textMuted,
                                needs_auth: theme.warning,
                                needs_client_registration: theme.error,
                              } as Record<string, typeof theme.success>
                            )[item.status],
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.text} wrapMode="word">
                          {key}{" "}
                          <span style={{ fg: theme.textMuted }}>
                            <Switch fallback={item.status}>
                              <Match when={item.status === "connected"}>Connected</Match>
                              <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                              <Match when={item.status === "disabled"}>Disabled</Match>
                              <Match when={(item.status as string) === "needs_auth"}>Needs auth</Match>
                              <Match when={(item.status as string) === "needs_client_registration"}>
                                Needs client ID
                              </Match>
                            </Switch>
                          </span>
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => sync.data.lsp.length > 2 && setExpanded("lsp", !expanded.lsp)}
              >
                <Show when={sync.data.lsp.length > 2}>
                  <text fg={theme.text}>{expanded.lsp ? "▼" : "▶"}</text>
                </Show>
                <text fg={theme.text}>
                  <b>LSP</b>
                </text>
              </box>
              <Show when={sync.data.lsp.length <= 2 || expanded.lsp}>
                <Show when={sync.data.lsp.length === 0}>
                  <text fg={theme.textMuted}>LSPs will activate as files are read</text>
                </Show>
                <For each={sync.data.lsp}>
                  {(item) => (
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        style={{
                          fg: {
                            connected: theme.success,
                            error: theme.error,
                          }[item.status],
                        }}
                      >
                        •
                      </text>
                      <text fg={theme.textMuted}>
                        {item.id} {item.root}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
            <Show when={todo().length > 0 && todo().some((t) => t.status !== "completed")}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => todo().length > 2 && setExpanded("todo", !expanded.todo)}
                >
                  <Show when={todo().length > 2}>
                    <text fg={theme.text}>{expanded.todo ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Todo</b>
                  </text>
                </box>
                <Show when={todo().length <= 2 || expanded.todo}>
                  <For each={todo()}>
                    {(todo) => (
                      <text style={{ fg: todo.status === "in_progress" ? theme.success : theme.textMuted }}>
                        [{todo.status === "completed" ? "✓" : " "}] {todo.content}
                      </text>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={diff().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => diff().length > 2 && setExpanded("diff", !expanded.diff)}
                >
                  <Show when={diff().length > 2}>
                    <text fg={theme.text}>{expanded.diff ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Modified Files</b>
                  </text>
                </box>
                <Show when={diff().length <= 2 || expanded.diff}>
                  <For each={diff() || []}>
                    {(item) => {
                      const file = createMemo(() => {
                        const splits = item.file.split(path.sep).filter(Boolean)
                        const last = splits.at(-1)!
                        const rest = splits.slice(0, -1).join(path.sep)
                        if (!rest) return last
                        return Locale.truncateMiddle(rest, 30 - last.length) + "/" + last
                      })
                      return (
                        <box flexDirection="row" gap={1} justifyContent="space-between">
                          <text fg={theme.textMuted} wrapMode="char">
                            {file()}
                          </text>
                          <box flexDirection="row" gap={1} flexShrink={0}>
                            <Show when={item.additions}>
                              <text fg={theme.diffAdded}>+{item.additions}</text>
                            </Show>
                            <Show when={item.deletions}>
                              <text fg={theme.diffRemoved}>-{item.deletions}</text>
                            </Show>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
            </Show>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={showUsageLimits()}>
            <box>
              <box flexDirection="row" gap={1} onMouseDown={() => setExpanded("usage", !expanded.usage)}>
                <text fg={theme.text}>{expanded.usage ? "▼" : "▶"}</text>
                <text fg={theme.text}>
                  <b>Usage Limits</b>
                </text>
              </box>
              <Show when={expanded.usage}>
                <Show when={!usageLoading()} fallback={<text fg={theme.textMuted}>Loading...</text>}>
                  <Show
                    when={usageData() && !usageData()?.error}
                    fallback={<text fg={theme.textMuted}>{usageData()?.error ?? "Waiting for usage…"}</text>}
                  >
                    <box gap={0}>
                      <Show when={usageData()?.planType}>
                        <text fg={theme.textMuted}>{usageData()!.planType}</text>
                      </Show>

                      <Show when={usageData()?.limits?.primary}>
                        {(() => {
                          const usedPercent = usageData()!.limits!.primary!.usedPercent ?? 0
                          const isMinimax = usageProviderID() === "minimax" || usageProviderID() === "minimax-coding-plan"
                          const remaining = isMinimax ? usedPercent : 100 - usedPercent
                          const color = usageColor(remaining)
                          const critical = remaining < 10
                          return (
                            <>
                              <text fg={theme.textMuted}>
                                {currentProvider() === "codex" ? "5h cycle" : "Primary"}:{" "}
                                <span style={{ fg: color }}>{remaining.toFixed(0)}%</span>{" "}
                                {usageBar(remaining)}
                              </text>
                              <Show when={usageData()!.limits!.primary!.resetsAt}>
                                <text fg={critical ? theme.error : theme.textMuted}>
                                  {formatTimeRemaining(usageData()!.limits!.primary!.resetsAt)}
                                </text>
                              </Show>
                            </>
                          )
                        })()}
                      </Show>
                      <Show when={usageData()?.limits?.secondary}>
                        {(() => {
                          const usedPercent = usageData()!.limits!.secondary!.usedPercent ?? 0
                          const isMinimax = usageProviderID() === "minimax" || usageProviderID() === "minimax-coding-plan"
                          const remaining = isMinimax ? usedPercent : 100 - usedPercent
                          const color = usageColor(remaining)
                          const critical = remaining < 10
                          return (
                            <>
                              <text fg={theme.textMuted}>
                                {currentProvider() === "codex" ? "Weekly cycle" : "Secondary"}:{" "}
                                <span style={{ fg: color }}>{remaining.toFixed(0)}%</span>{" "}
                                {usageBar(remaining)}
                              </text>
                              <Show when={usageData()!.limits!.secondary!.resetsAt}>
                                <text fg={critical ? theme.error : theme.textMuted}>
                                  {formatTimeRemaining(usageData()!.limits!.secondary!.resetsAt)}
                                </text>
                              </Show>
                            </>
                          )
                        })()}
                      </Show>
                      <Show when={usageData()?.credits?.unlimited}>
                        <text fg={theme.success}>Unlimited credits</text>
                      </Show>
                      <Show
                        when={usageData()?.credits && !usageData()!.credits!.unlimited && usageData()!.credits!.balance}
                      >
                        <text fg={theme.textMuted}>Balance: {usageData()!.credits!.balance}</text>
                      </Show>
                      <Show
                        when={usageData()?.limitReached && (() => {
                          const usedPercent = usageData()!.limits?.primary?.usedPercent ?? 0
                          const isMinimax = usageProviderID() === "minimax" || usageProviderID() === "minimax-coding-plan"
                          const remaining = isMinimax ? usedPercent : 100 - usedPercent
                          return remaining < 100
                        })()}
                      >
                        <text fg={theme.error}>⚠ Limit reached</text>
                      </Show>
                    </box>
                  </Show>
                </Show>
              </Show>
            </box>
          </Show>
          <Show when={!hasProviders()}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              flexDirection="row"
              gap={1}
            >
              <text flexShrink={0} fg={theme.text}>
                ⬖
              </text>
              <box flexGrow={1} gap={1}>
                <text fg={theme.text}>
                  <b>Getting started</b>
                </text>
                <text fg={theme.textMuted}>Arctic includes free models so you can start immediately.</text>
                <text fg={theme.textMuted}>
                  Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
                </text>
                <box flexDirection="row" gap={1} justifyContent="space-between">
                  <text fg={theme.text}>Connect provider</text>
                  <text fg={theme.textMuted}>/connect</text>
                </box>
              </box>
            </box>
          </Show>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span>{" "}
            <span style={{ fg: theme.text }}>
              <b>Arctic</b>
            </span>{" "}
            <span>{Installation.VERSION}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
