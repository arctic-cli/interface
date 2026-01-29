import { ProviderUsage } from "@/provider/usage"
import { Locale } from "@/util/locale"
import { InputRenderable, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useSync } from "@tui/context/sync"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"

const BAR_SEGMENTS = 20
const BAR_FILLED = "█"
const BAR_EMPTY = "░"
const SIDEBAR_WIDTH = 20

const PROVIDER_COLOR_PAIRS: Array<[string, string]> = [
  ["#ef4444", "#f97316"],
  ["#60a5fa", "#3b82f6"],
  ["#34d399", "#22c55e"],
  ["#f59e0b", "#facc15"],
  ["#a78bfa", "#8b5cf6"],
  ["#f472b6", "#ec4899"],
]

function hashProviderName(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function providerColorPair(providerBase: string): [string, string] {
  const index = hashProviderName(providerBase) % PROVIDER_COLOR_PAIRS.length
  return PROVIDER_COLOR_PAIRS[index]
}

function truncateName(name: string, maxLength: number): string {
  if (name.length <= maxLength) {
    return name
  }
  return name.slice(0, maxLength - 3) + "..."
}

async function fetchUsageRecord(input: {
  baseUrl?: string
  directory?: string
  sessionID?: string
  providerID: string
}) {
  if (!input.baseUrl) return undefined
  const url = new URL(`/usage/providers/${encodeURIComponent(input.providerID)}`, input.baseUrl)
  const res = await fetch(`${url}`, {
    headers: {
      ...(input.directory ? { "x-arctic-directory": input.directory } : {}),
      ...(input.sessionID ? { "x-arctic-session-id": input.sessionID } : {}),
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

export function DialogUsage() {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const route = useRoute()
  const dimensions = useTerminalDimensions()

  const [selectedProvider, setSelectedProvider] = createSignal<string | null>(null)
  const [searchQuery, setSearchQuery] = createSignal("")
  const [debouncedQuery, setDebouncedQuery] = createSignal("")
  const [usageState, setUsageState] = createStore<{
    records: Record<string, ProviderUsage.Record>
    loading: Record<string, boolean>
  }>({
    records: {},
    loading: {},
  })
  const inFlight = new Map<string, Promise<void>>()
  let prefetchSeq = 0
  let debounceTimeout: Timer | undefined

  let scroll: ScrollBoxRenderable
  let sidebarScroll: ScrollBoxRenderable
  let searchInput: InputRenderable | undefined

  createEffect(() => {
    const query = searchQuery()
    if (debounceTimeout) clearTimeout(debounceTimeout)

    debounceTimeout = setTimeout(() => {
      setDebouncedQuery(query)
    }, 500)

    onCleanup(() => {
      if (debounceTimeout) clearTimeout(debounceTimeout)
    })
  })

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      if (searchQuery().length > 0) {
        evt.preventDefault()
        setSearchQuery("")
        setDebouncedQuery("")
        if (debounceTimeout) clearTimeout(debounceTimeout)
        if (searchInput) searchInput.focus()
        return
      }
      return
    }

    // Scroll navigation for content
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      scroll?.scrollBy(-1)
      return
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      scroll?.scrollBy(1)
      return
    }
    if (evt.name === "pageup") {
      evt.preventDefault()
      scroll?.scrollBy(-10)
      return
    }
    if (evt.name === "pagedown") {
      evt.preventDefault()
      scroll?.scrollBy(10)
      return
    }

    // Tab/Shift+Tab for provider navigation
    if (evt.name === "tab" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      const providers = filteredProviderTabs()
      if (providers.length > 0) {
        const current = selectedProvider()
        const currentIndex = current ? providers.indexOf(current) : -1
        const nextIndex = evt.shift
          ? (currentIndex - 1 + providers.length) % providers.length
          : (currentIndex + 1) % providers.length
        setSelectedProvider(providers[nextIndex])
      }
      return
    }
  })

  onMount(() => {
    dialog.setSize("xlarge")
    if (searchInput) searchInput.focus()
  })

  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const providerById = createMemo(() => {
    return Object.fromEntries(sync.data.provider.map((provider) => [provider.id, provider]))
  })

  const baseNameCounts = createMemo(() => {
    const counts: Record<string, number> = {}
    for (const provider of sync.data.provider) {
      const baseName = provider.baseProvider ?? provider.id
      counts[baseName] = (counts[baseName] ?? 0) + 1
    }
    return counts
  })

  const baseNameIndex = createMemo(() => {
    const seen: Record<string, number> = {}
    const indices: Record<string, number> = {}
    for (const provider of sync.data.provider) {
      const baseName = provider.baseProvider ?? provider.id
      const idx = seen[baseName] ?? 0
      indices[provider.id] = idx
      seen[baseName] = idx + 1
    }
    return indices
  })

  const providerTabs = createMemo(() => {
    const providers = sync.data.provider.map((provider) => provider.id)
    return [...providers].sort((a, b) => {
      // access the store directly to make this reactive
      const tokensA = usageState.records[a]?.tokenUsage?.total ?? 0
      const tokensB = usageState.records[b]?.tokenUsage?.total ?? 0
      if (tokensA !== tokensB) return tokensB - tokensA
      const nameA = providerById()[a]?.name ?? a
      const nameB = providerById()[b]?.name ?? b
      return nameA.localeCompare(nameB)
    })
  })

  const filteredProviderTabs = createMemo(() => {
    const query = debouncedQuery().toLowerCase().trim()
    if (!query) return providerTabs()

    return providerTabs().filter((providerID) => {
      const provider = providerById()[providerID]
      const name = provider?.name?.toLowerCase() ?? ""
      const id = providerID.toLowerCase()
      return name.includes(query) || id.includes(query)
    })
  })

  // Auto-select first provider only when selection is missing
  createEffect(() => {
    const filtered = filteredProviderTabs()
    const current = untrack(selectedProvider)
    if (filtered.length === 0) {
      if (current !== null) {
        setSelectedProvider(null)
      }
      return
    }
    if (!current || !filtered.includes(current)) {
      setSelectedProvider(filtered[0])
    }
  })

  const selectedRecord = createMemo(() => {
    const selected = selectedProvider()
    if (!selected) return undefined
    return usageState.records[selected]
  })
  const selectedLoading = createMemo(() => {
    const selected = selectedProvider()
    if (!selected) return false
    return Boolean(usageState.loading[selected])
  })
  const visibleRecords = createMemo(() => (selectedRecord() ? [selectedRecord()!] : []))
  const hasEntries = createMemo(() => visibleRecords().length > 0)
  const height = createMemo(() => {
    return Math.min(20, Math.floor(dimensions().height * 0.7))
  })

  const duplicateAccountInfo = createMemo(() => {
    const records = usageState.records
    const accountToProviders: Record<string, string[]> = {}

    for (const [providerID, record] of Object.entries(records)) {
      if (!record.accountId) continue
      const provider = providerById()[providerID]
      const baseName = provider?.baseProvider ?? providerID
      if (!baseName.includes("github-copilot")) continue

      if (!accountToProviders[record.accountId]) {
        accountToProviders[record.accountId] = []
      }
      accountToProviders[record.accountId].push(providerID)
    }

    const duplicates: Record<string, { accountId: string; accountUsername?: string; providers: string[] }> = {}
    for (const [accountId, providers] of Object.entries(accountToProviders)) {
      if (providers.length > 1) {
        const username = providers.map((p) => records[p]?.accountUsername).find((u) => u)
        for (const providerID of providers) {
          duplicates[providerID] = { accountId, accountUsername: username, providers }
        }
      }
    }

    return duplicates
  })

  const loadProviderUsage = (providerID: string) => {
    if (!providerID || !sdk.url) return Promise.resolve()
    if (usageState.records[providerID]) return Promise.resolve()
    const existing = inFlight.get(providerID)
    if (existing) return existing

    const promise = (async () => {
      setUsageState("loading", providerID, true)
      try {
        const record = await fetchUsageRecord({
          baseUrl: sdk.url,
          directory: sync.data.path.directory,
          sessionID: sessionID(),
          providerID,
        })
        if (record) {
          setUsageState("records", providerID, record)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setUsageState("records", providerID, {
          providerID,
          providerName: providerById()[providerID]?.name ?? providerID,
          fetchedAt: Date.now(),
          error: message,
        })
      } finally {
        setUsageState("loading", providerID, false)
        inFlight.delete(providerID)
      }
    })()

    inFlight.set(providerID, promise)
    return promise
  }

  createEffect(() => {
    const selected = selectedProvider()
    if (!selected) return
    void loadProviderUsage(selected)
  })

  createEffect(() => {
    const tabs = providerTabs()
    if (tabs.length === 0) return
    prefetchSeq += 1
    const seq = prefetchSeq
    void (async () => {
      for (const providerID of tabs) {
        if (prefetchSeq !== seq) return
        await loadProviderUsage(providerID)
      }
    })()
  })

  return (
    <box paddingLeft={2} paddingRight={2}>
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Usage
        </text>
        <text fg={theme.textMuted}>esc · tab/shift+tab · click to switch</text>
      </box>

      <box paddingBottom={1} flexDirection="row" alignItems="flex-start" gap={1}>
        <text fg={theme.textMuted}>Search:</text>
        <input
          ref={(r: InputRenderable) => (searchInput = r)}
          value={searchQuery()}
          onInput={(value: string) => setSearchQuery(value)}
          placeholder="Type to filter providers..."
          flexGrow={1}
          focusedBackgroundColor={theme.backgroundPanel}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
        />
      </box>

      <box flexDirection="row" gap={2}>
        <Show when={filteredProviderTabs().length > 0}>
          <box flexDirection="column" width={SIDEBAR_WIDTH} flexShrink={0}>
            <text fg={theme.textMuted} paddingBottom={1}>
              Providers
            </text>
            <scrollbox
              ref={(r: ScrollBoxRenderable) => (sidebarScroll = r)}
              height={height()}
              flexDirection="column"
              scrollbarOptions={{
                visible: false,
              }}
            >
              <For each={filteredProviderTabs()}>
                {(providerID) => {
                  const record = () => usageState.records[providerID]
                  const name = () => record()?.providerName ?? providerById()[providerID]?.name ?? providerID
                  const isSelected = () => selectedProvider() === providerID
                  const loading = () => usageState.loading[providerID]
                  const baseName = () => providerById()[providerID]?.baseProvider ?? providerID
                  const hasDuplicate = () => (baseNameCounts()[baseName()] ?? 0) > 1
                  const duplicateIndex = () => baseNameIndex()[providerID] ?? 0
                  const colorPair = () => providerColorPair(baseName())
                  const duplicateColor = () => (duplicateIndex() % 2 === 0 ? colorPair()[0] : colorPair()[1])

                  return (
                    <box
                      paddingLeft={1}
                      paddingRight={1}
                      onMouseUp={() => setSelectedProvider(providerID)}
                      backgroundColor={isSelected() ? theme.primary : undefined}
                    >
                      <text
                        attributes={isSelected() ? TextAttributes.BOLD : undefined}
                        style={{
                          fg: isSelected() ? "#ffffff" : hasDuplicate() ? duplicateColor() : theme.text,
                        }}
                      >
                        {truncateName(name(), SIDEBAR_WIDTH - 2)}
                        {loading() && " ⋯"}
                      </text>
                    </box>
                  )
                }}
              </For>
            </scrollbox>
          </box>
        </Show>

        {/* Right content area */}
        <box flexDirection="column" flexGrow={1}>
          <Show when={filteredProviderTabs().length === 0 && debouncedQuery().length > 0}>
            <text fg={theme.textMuted}>No matches found for "{debouncedQuery()}"</text>
          </Show>

          {!selectedProvider() && filteredProviderTabs().length > 0 && (
            <text fg={theme.textMuted}>No providers available.</text>
          )}
          {selectedProvider() && selectedLoading() && !hasEntries() && <text fg={theme.textMuted}>Loading usage…</text>}
          {selectedProvider() && hasEntries() && (
            <scrollbox
              ref={(r: ScrollBoxRenderable) => (scroll = r)}
              height={height()}
              flexDirection="column"
              gap={1}
              scrollbarOptions={{
                visible: false,
              }}
            >
              <For each={visibleRecords()}>
                {(record) => <UsageCard record={record} duplicateInfo={duplicateAccountInfo()[record.providerID]} />}
              </For>
            </scrollbox>
          )}
        </box>
      </box>
    </box>
  )
}

function UsageCard(props: {
  record: ProviderUsage.Record
  duplicateInfo?: { accountId: string; accountUsername?: string; providers: string[] }
}) {
  const { theme } = useTheme()
  const status = createMemo(() => describeStatus(props.record))
  const limits = createMemo(() => describeLimits(props.record.limits, props.record.providerID))

  // check if this is minimax with quota limits configured
  const isMiniMaxWithLimits = createMemo(() => {
    const isMinimax = props.record.providerID === "minimax" || props.record.providerID === "minimax-coding-plan"
    const hasLimits = !!props.record.limits?.primary
    return isMinimax && hasLimits
  })

  const isAntigravity = createMemo(() => props.record.providerID === "antigravity")
  const hideTokenUsage = createMemo(() => isMiniMaxWithLimits() || isAntigravity())

  const costLabel = "Session Cost"

  return (
    <box border={["left"]} borderColor={status().color} paddingLeft={2} paddingBottom={1}>
      <text fg="#60a5fa" attributes={TextAttributes.BOLD}>
        {props.record.providerName}
      </text>
      <Show when={props.record.planType}>{(plan) => <text fg={theme.textMuted}>Plan · {plan()}</text>}</Show>
      <Show when={props.record.fetchedAt}>
        {(time) => <text fg={theme.textMuted}>Updated {Locale.todayTimeOrDateTime(time())}</text>}
      </Show>
      <text fg={theme.text}>
        Access: <span style={{ fg: status().color }}>{status().label}</span>
      </text>
      <Show when={props.record.accountUsername}>
        {(username) => (
          <text fg={theme.text}>
            GitHub: <span style={{ fg: "#60a5fa" }}>@{username()}</span>
          </text>
        )}
      </Show>
      <Show when={props.record.credits}>
        {(credits) => (
          <text fg={theme.text}>
            Credits: <span style={{ fg: "#a78bfa" }}>{describeCredits(credits())}</span>
          </text>
        )}
      </Show>
      <Show when={!hideTokenUsage()}>
        <Show when={props.record.tokenUsage}>
          {(usage) => (
            <box>
              <text fg={theme.textMuted}>Token Usage</text>
              <box marginLeft={2} flexDirection="column">
                <Show when={usage().total !== undefined}>
                  <text fg={theme.text}>
                    <b>Total:</b> <span style={{ fg: "#34d399" }}>{formatTokenNumber(usage().total!)}</span>
                  </text>
                </Show>
                <Show when={usage().input !== undefined}>
                  <text fg={theme.text}>
                    <b>Input:</b> <span style={{ fg: "#60a5fa" }}>{formatTokenNumber(usage().input!)}</span>
                  </text>
                </Show>
                <Show when={usage().output !== undefined}>
                  <text fg={theme.text}>
                    <b>Output:</b> <span style={{ fg: "#f472b6" }}>{formatTokenNumber(usage().output!)}</span>
                  </text>
                </Show>
                <Show when={usage().cached !== undefined}>
                  <text fg={theme.text}>
                    <b>Cached:</b> <span style={{ fg: "#a78bfa" }}>{formatTokenNumber(usage().cached!)}</span>
                  </text>
                </Show>
              </box>
            </box>
          )}
        </Show>
      </Show>
      <Show when={!hideTokenUsage()}>
        <Show when={props.record.costSummary}>
          {(cost) => (
            <box>
              <text fg={theme.textMuted}>{costLabel}</text>
              <box marginLeft={2} flexDirection="column">
                <Show when={cost().totalCost !== undefined}>
                  <text fg={theme.text}>
                    <b>Total:</b> <span style={{ fg: "#fbbf24" }}>{formatCurrency(cost().totalCost!)}</span>
                  </text>
                </Show>
                <Show when={cost().inputCost !== undefined && (cost().inputCost ?? 0) > 0}>
                  <text fg={theme.text}>
                    <b>Input:</b> <span style={{ fg: "#60a5fa" }}>{formatCurrency(cost().inputCost ?? 0)}</span>
                  </text>
                </Show>
                <Show when={cost().outputCost !== undefined && (cost().outputCost ?? 0) > 0}>
                  <text fg={theme.text}>
                    <b>Output:</b> <span style={{ fg: "#f472b6" }}>{formatCurrency(cost().outputCost ?? 0)}</span>
                  </text>
                </Show>
                <Show when={cost().cacheReadCost !== undefined && (cost().cacheReadCost ?? 0) > 0}>
                  <text fg={theme.text}>
                    <b>Cache Read:</b>{" "}
                    <span style={{ fg: "#a78bfa" }}>{formatCurrency(cost().cacheReadCost ?? 0)}</span>
                  </text>
                </Show>
                <Show when={cost().cacheCreationCost !== undefined && (cost().cacheCreationCost ?? 0) > 0}>
                  <text fg={theme.text}>
                    <b>Cache Write:</b>{" "}
                    <span style={{ fg: "#c084fc" }}>{formatCurrency(cost().cacheCreationCost ?? 0)}</span>
                  </text>
                </Show>
              </box>
            </box>
          )}
        </Show>
      </Show>
      <Show when={limits().length && props.record.providerID !== "z.ai"}>
        <box>
          <text fg={theme.textMuted}>Limits</text>
          <box marginLeft={2} flexDirection="column">
            <For each={limits()}>
              {(limit) => (
                <text fg={theme.text}>
                  <b>{limit.label}:</b> <span style={{ fg: limit.color }}>{limit.detail}</span>
                  <Show when={limit.reset}>{(reset) => <span style={{ fg: theme.textMuted }}> · {reset()}</span>}</Show>
                </text>
              )}
            </For>
          </box>
        </box>
      </Show>
      <Show when={props.duplicateInfo}>
        {(info) => {
          const otherProviders = info().providers.filter((p) => p !== props.record.providerID)
          const username = info().accountUsername
          return (
            <text fg="#f5a524">
              ⚠ Same GitHub account{username ? ` (@${username})` : ""} as: {otherProviders.join(", ")}
            </text>
          )
        }}
      </Show>
      <Show when={props.record.error}>{(msg) => <text fg={theme.error}>⚠ {msg()}</text>}</Show>
    </box>
  )
}

function describeStatus(record: ProviderUsage.Record) {
  if (record.error) return { label: "error", color: "#ff5c5c" }
  if (record.allowed === false) {
    return {
      label: record.limitReached ? "blocked (limit reached)" : "blocked",
      color: "#ff5c5c",
    }
  }
  if (record.limitReached) {
    return {
      label: "limit reached",
      color: "#f5a524",
    }
  }
  return { label: "allowed", color: "#4caf50" }
}

function describeCredits(credits: ProviderUsage.CreditsSummary): string {
  if (credits.unlimited) return "unlimited plan"
  if (!credits.hasCredits) return "not included"
  if (credits.balance) return `balance ${credits.balance}`
  return "available"
}

function describeLimits(
  limits: ProviderUsage.Record["limits"],
  providerID?: string,
): { label: string; detail: string; reset?: string; color: string }[] {
  if (!limits) return []
  const showRemainingDirectly = providerID === "minimax" || providerID === "minimax-coding-plan"
  const options = showRemainingDirectly ? { showRemainingDirectly: true } : undefined
  const rows: { label: string; detail: string; reset?: string; color: string }[] = []
  const primary = describeLimit(limits.primary?.label ?? "Primary", limits.primary, options)
  if (primary) rows.push(primary)
  const secondary = describeLimit(limits.secondary?.label ?? "Secondary", limits.secondary, options)
  if (secondary) rows.push(secondary)
  return rows
}

function describeLimit(
  label: string,
  window?: ProviderUsage.RateLimitWindowSummary,
  options?: { showRemainingDirectly?: boolean },
): { label: string; detail: string; reset?: string; color: string } | undefined {
  if (!window) return undefined
  const usedPercent = window.usedPercent ?? 0
  const remaining = options?.showRemainingDirectly ? usedPercent : Math.max(0, 100 - usedPercent)

  const color = remaining >= 70 ? "#34d399" : remaining >= 40 ? "#fbbf24" : "#f87171"

  const detail = `${remaining.toFixed(0)}% ${progressBar(remaining)}`

  return {
    label,
    detail,
    reset: window.resetsAt ? formatReset(window.resetsAt) : undefined,
    color,
  }
}

function progressBar(percentRemaining: number): string {
  const clamped = Math.max(0, Math.min(100, percentRemaining))
  const filled = Math.round((clamped / 100) * BAR_SEGMENTS)
  return `[${BAR_FILLED.repeat(filled)}${BAR_EMPTY.repeat(BAR_SEGMENTS - filled)}]`
}

function formatReset(timestampSeconds: number) {
  const resetDate = new Date(timestampSeconds * 1000)
  const diffMs = resetDate.getTime() - Date.now()
  const minutes = Math.max(0, Math.round(diffMs / 60000))
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  const relative = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  return `resets in ${relative} (${resetDate.toISOString()})`
}

function formatTokenNumber(value: number): string {
  const abs = Math.abs(value)
  const units = [
    { value: 1_000_000_000_000, suffix: "T" },
    { value: 1_000_000_000, suffix: "B" },
    { value: 1_000_000, suffix: "M" },
    { value: 1_000, suffix: "k" },
  ]
  for (const unit of units) {
    if (abs >= unit.value) {
      const scaled = value / unit.value
      const precision = Math.abs(scaled) < 10 ? 1 : 0
      return `${scaled.toFixed(precision).replace(/\.0$/, "")}${unit.suffix}`
    }
  }
  return Math.round(value) === value ? value.toString() : value.toFixed(1).replace(/\.0$/, "")
}

function formatCurrency(amount: number): string {
  if (amount === 0) return "$0.00"
  if (amount < 0.00001) return "<$0.00001"
  if (amount < 0.01) return `$${amount.toFixed(5)}`
  if (amount < 1) return `$${amount.toFixed(3)}`
  return `$${amount.toFixed(2)}`
}
