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
const MAX_TAB_NAME_LENGTH = 15
const CODING_PLAN_PROVIDERS = new Set([
  "codex",
  "zai-coding-plan",
  "minimax",
  "minimax-coding-plan",
  "anthropic",
  "@ai-sdk/anthropic",
  "github-copilot",
  "google",
  "kimi-for-coding",
])

function truncateTabName(name: string): string {
  if (name.length <= MAX_TAB_NAME_LENGTH) {
    return name
  }
  return name.slice(0, MAX_TAB_NAME_LENGTH - 3) + "..."
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
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

    // Scroll navigation
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

    // Tab navigation for providers (consume event immediately)
    if (evt.name === "tab" && !evt.shift && !evt.ctrl && !evt.meta) {
      // Always prevent default to stop mode switching
      evt.preventDefault()
      const providers = filteredProviderTabs()
      if (providers.length > 0) {
        const current = selectedProvider()
        const currentIndex = current ? providers.indexOf(current) : -1
        const nextIndex = (currentIndex + 1) % providers.length
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

  const providerTabs = createMemo(() => {
    const coding: string[] = []
    const api: string[] = []
    for (const provider of sync.data.provider) {
      if (CODING_PLAN_PROVIDERS.has(provider.id)) {
        coding.push(provider.id)
      } else {
        api.push(provider.id)
      }
    }
    return [...coding, ...api]
  })

  const providerById = createMemo(() => {
    return Object.fromEntries(sync.data.provider.map((provider) => [provider.id, provider]))
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

  // Auto-select first provider from filtered list
  createEffect(() => {
    const filtered = filteredProviderTabs()
    if (filtered.length > 0) {
      const firstProvider = filtered[0]
      const current = untrack(selectedProvider)
      if (current !== firstProvider) {
        setSelectedProvider(firstProvider)
      }
    } else {
      const current = untrack(selectedProvider)
      if (current !== null) {
        setSelectedProvider(null)
      }
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
        <text fg={theme.textMuted}>esc · tab to switch providers</text>
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

      {/* Provider Tabs */}
      <Show when={filteredProviderTabs().length > 0}>
        <box flexDirection="column" gap={1} paddingBottom={1}>
          <For each={chunkArray(filteredProviderTabs(), 8)}>
            {(row) => (
              <box flexDirection="row" gap={1}>
                <For each={row}>
                  {(providerID) => {
                    const record = () => usageState.records[providerID]
                    const name = () =>
                      truncateTabName(record()?.providerName ?? providerById()[providerID]?.name ?? providerID)
                    return (
                      <box paddingLeft={2} paddingRight={2} paddingTop={0} paddingBottom={0} flexShrink={0}>
                        <text
                          attributes={selectedProvider() === providerID ? TextAttributes.BOLD : undefined}
                          style={{
                            bg: selectedProvider() === providerID ? "#2563eb" : undefined,
                            fg: selectedProvider() === providerID ? "#ffffff" : theme.textMuted,
                          }}
                        >
                          {name()}
                        </text>
                      </box>
                    )
                  }}
                </For>
              </box>
            )}
          </For>
        </box>
      </Show>

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
          <For each={visibleRecords()}>{(record) => <UsageCard record={record} />}</For>
        </scrollbox>
      )}
    </box>
  )
}

function UsageCard(props: { record: ProviderUsage.Record }) {
  const { theme } = useTheme()
  const status = createMemo(() => describeStatus(props.record))
  const limits = createMemo(() => describeLimits(props.record.limits, props.record.providerID))

  // check if this is minimax with quota limits configured
  const isMiniMaxWithLimits = createMemo(() => {
    const isMinimax = props.record.providerID === "minimax" || props.record.providerID === "minimax-coding-plan"
    const hasLimits = !!props.record.limits?.primary
    return isMinimax && hasLimits
  })

  const costLabel = "Session Cost"

  return (
    <box border={["left"]} borderColor={status().color} paddingLeft={2} paddingBottom={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.record.providerName}
      </text>
      <Show when={props.record.planType}>{(plan) => <text fg={theme.textMuted}>Plan · {plan()}</text>}</Show>
      <Show when={props.record.fetchedAt}>
        {(time) => <text fg={theme.textMuted}>Updated {Locale.todayTimeOrDateTime(time())}</text>}
      </Show>
      <text fg={theme.text}>
        Access: <span style={{ fg: status().color }}>{status().label}</span>
      </text>
      <Show when={props.record.credits}>
        {(credits) => <text fg={theme.text}>Credits: {describeCredits(credits())}</text>}
      </Show>
      <Show when={!isMiniMaxWithLimits()}>
        <Show when={props.record.tokenUsage}>
          {(usage) => (
            <box>
              <text fg={theme.textMuted}>Token Usage</text>
              <box marginLeft={2} flexDirection="column">
                <Show when={usage().total !== undefined}>
                  <text fg={theme.text}>
                    <b>Total:</b> {formatTokenNumber(usage().total!)}
                  </text>
                </Show>
                <Show when={usage().input !== undefined}>
                  <text fg={theme.text}>
                    <b>Input:</b> {formatTokenNumber(usage().input!)}
                  </text>
                </Show>
                <Show when={usage().output !== undefined}>
                  <text fg={theme.text}>
                    <b>Output:</b> {formatTokenNumber(usage().output!)}
                  </text>
                </Show>
                <Show when={usage().cached !== undefined}>
                  <text fg={theme.text}>
                    <b>Cached:</b> {formatTokenNumber(usage().cached!)}
                  </text>
                </Show>
              </box>
            </box>
          )}
        </Show>
      </Show>
      <Show when={!isMiniMaxWithLimits()}>
        <Show when={props.record.costSummary}>
          {(cost) => (
            <box>
              <text fg={theme.textMuted}>{costLabel}</text>
              <box marginLeft={2} flexDirection="column">
                <Show when={cost().totalCost !== undefined}>
                  <text fg={theme.text}>
                    <b>Total:</b> {formatCurrency(cost().totalCost!)}
                  </text>
                </Show>
                <Show when={cost().inputCost !== undefined && (cost().inputCost ?? 0) > 0}>
                  <text fg={theme.text}>
                    <b>Input:</b> {formatCurrency(cost().inputCost ?? 0)}
                  </text>
                </Show>
                <Show when={cost().outputCost !== undefined && (cost().outputCost ?? 0) > 0}>
                  <text fg={theme.text}>
                    <b>Output:</b> {formatCurrency(cost().outputCost ?? 0)}
                  </text>
                </Show>
                <Show when={cost().cacheReadCost !== undefined && (cost().cacheReadCost ?? 0) > 0}>
                  <text fg={theme.text}>
                    <b>Cache Read:</b> {formatCurrency(cost().cacheReadCost ?? 0)}
                  </text>
                </Show>
                <Show when={cost().cacheCreationCost !== undefined && (cost().cacheCreationCost ?? 0) > 0}>
                  <text fg={theme.text}>
                    <b>Cache Write:</b> {formatCurrency(cost().cacheCreationCost ?? 0)}
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
                  <b>{limit.label}:</b> {limit.detail}
                  <Show when={limit.reset}>{(reset) => <span style={{ fg: theme.textMuted }}> · {reset()}</span>}</Show>
                </text>
              )}
            </For>
          </box>
        </box>
      </Show>
      <Show when={props.record.error}>{(msg) => <text fg={theme.error}>⚠ {msg()}</text>}</Show>
    </box>
  )
}

function describeStatus(record: ProviderUsage.Record) {
  if (record.error) return { label: record.error, color: "#ff5c5c" }
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
): { label: string; detail: string; reset?: string }[] {
  if (!limits) return []
  const isMinimax = providerID === "minimax" || providerID === "minimax-coding-plan"
  const rows: { label: string; detail: string; reset?: string }[] = []
  const primary = describeLimit(limits.primary?.label ?? "Primary", limits.primary, isMinimax)
  if (primary) rows.push(primary)
  const secondary = describeLimit(limits.secondary?.label ?? "Secondary", limits.secondary, isMinimax)
  if (secondary) rows.push(secondary)
  return rows
}

function describeLimit(
  label: string,
  window?: ProviderUsage.RateLimitWindowSummary,
  isMinimax = false,
): { label: string; detail: string; reset?: string } | undefined {
  if (!window) return undefined
  const usedPercent = window.usedPercent ?? 0
  const remaining = isMinimax ? usedPercent : Math.max(0, 100 - usedPercent)
  const detail = `${remaining.toFixed(0)}% ${progressBar(remaining)}`
  return {
    label,
    detail,
    reset: window.resetsAt ? formatReset(window.resetsAt) : undefined,
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
