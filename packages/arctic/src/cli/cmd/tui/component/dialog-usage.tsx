import { ProviderUsage } from "@/provider/usage"
import { Locale } from "@/util/locale"
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useSync } from "@tui/context/sync"
import { For, Show, createMemo, createResource, createSignal, onMount } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useRoute } from "../context/route"

const BAR_SEGMENTS = 20
const BAR_FILLED = "█"
const BAR_EMPTY = "░"

async function fetchUsageRecords(input: {
  baseUrl?: string
  directory?: string
  sessionID?: string
  timePeriod?: ProviderUsage.TimePeriod
}) {
  if (!input.baseUrl) return []
  const url = new URL("/usage/providers", input.baseUrl)
  const params = new URLSearchParams()
  if (input.timePeriod) params.set("timePeriod", input.timePeriod)

  const res = await fetch(`${url}?${params}`, {
    headers: {
      ...(input.directory ? { "x-arctic-directory": input.directory } : {}),
      ...(input.sessionID ? { "x-arctic-session-id": input.sessionID } : {}),
      ...(input.timePeriod ? { "x-arctic-time-period": input.timePeriod } : {}),
    },
    credentials: "include",
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Request failed (${res.status}): ${body || res.statusText}`)
  }
  return (await res.json()) as ProviderUsage.Record[]
}

export function DialogUsage() {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const route = useRoute()
  const dimensions = useTerminalDimensions()

  const [selectedProvider, setSelectedProvider] = createSignal<string | null>(null)
  const [timePeriod, setTimePeriod] = createSignal<ProviderUsage.TimePeriod>("session")

  let scroll: ScrollBoxRenderable

  useKeyboard((evt) => {
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
      const providers = providerTabs()
      if (providers.length > 0) {
        const current = selectedProvider()
        const currentIndex = current ? providers.indexOf(current) : -1
        const nextIndex = (currentIndex + 1) % providers.length
        setSelectedProvider(providers[nextIndex])
      }
      return
    }

    // Number keys for time period selection (only for z.ai and anthropic)
    const provider = selectedProvider()
    if (provider === "zai-coding-plan" || provider === "anthropic" || provider === "@ai-sdk/anthropic") {
      if (evt.name === "1" && !evt.ctrl && !evt.meta && !evt.shift) {
        evt.preventDefault()
        setTimePeriod("session")
        return
      }
      if (evt.name === "2" && !evt.ctrl && !evt.meta && !evt.shift) {
        evt.preventDefault()
        setTimePeriod("daily")
        return
      }
      if (evt.name === "3" && !evt.ctrl && !evt.meta && !evt.shift) {
        evt.preventDefault()
        setTimePeriod("weekly")
        return
      }
      if (evt.name === "4" && !evt.ctrl && !evt.meta && !evt.shift) {
        evt.preventDefault()
        setTimePeriod("monthly")
        return
      }
    }
  })

  onMount(() => {
    dialog.setSize("xlarge")
  })

  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const [records] = createResource(
    () => ({
      baseUrl: sdk.url,
      directory: sync.data.path.directory,
      sessionID: sessionID(),
      timePeriod: timePeriod(),
    }),
    fetchUsageRecords,
  )

  const providerTabs = createMemo(() => {
    const allRecords = records() ?? []
    return allRecords.map((r) => r.providerID)
  })

  // Auto-select first provider
  createMemo(() => {
    const tabs = providerTabs()
    if (tabs.length > 0 && !selectedProvider()) {
      setSelectedProvider(tabs[0])
    }
  })

  const filteredRecords = createMemo(() => {
    const allRecords = records() ?? []
    const selected = selectedProvider()
    if (!selected) return allRecords
    return allRecords.filter((r) => r.providerID === selected)
  })

  const hasEntries = createMemo(() => filteredRecords().length > 0)
  const height = createMemo(() => {
    return Math.min(20, Math.floor(dimensions().height * 0.7))
  })

  const showTimePeriodTabs = createMemo(() => {
    const provider = selectedProvider()
    return provider === "zai-coding-plan" || provider === "anthropic" || provider === "@ai-sdk/anthropic"
  })

  return (
    <box paddingLeft={2} paddingRight={2}>
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Usage
        </text>
        <text fg={theme.textMuted}>esc · tab to switch providers</text>
      </box>

      {/* Provider Tabs */}
      <box flexDirection="row" gap={1} paddingBottom={1}>
        <For each={providerTabs()}>
          {(providerID) => {
            const record = records()?.find((r) => r.providerID === providerID)
            return (
              <box
                paddingLeft={2}
                paddingRight={2}
                paddingTop={0}
                paddingBottom={0}
              >
                <text
                  attributes={selectedProvider() === providerID ? TextAttributes.BOLD : undefined}
                  style={{
                    bg: selectedProvider() === providerID ? "#2563eb" : undefined,
                    fg: selectedProvider() === providerID ? "#ffffff" : theme.textMuted,
                  }}
                >
                  {record?.providerName ?? providerID}
                </text>
              </box>
            )
          }}
        </For>
      </box>

      {/* Time Period Tabs (for Z.ai and Anthropic only) */}
      <Show when={showTimePeriodTabs()}>
        <box flexDirection="row" gap={1} paddingBottom={1}>
          <For each={["session", "daily", "weekly", "monthly"] as ProviderUsage.TimePeriod[]}>
            {(period) => {
              return (
                <box
                  paddingLeft={2}
                  paddingRight={2}
                >
                  <text
                    attributes={timePeriod() === period ? TextAttributes.BOLD : undefined}
                    style={{
                      bg: timePeriod() === period ? "#16a34a" : undefined,
                      fg: timePeriod() === period ? "#ffffff" : theme.textMuted,
                    }}
                  >
                    {period.charAt(0).toUpperCase() + period.slice(1)} ({getPeriodKey(period)})
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      </Show>

      {records.error && <text fg={theme.error}>Failed to load usage: {String(records.error)}</text>}
      {!records.error && records.loading && <text fg={theme.textMuted}>Loading usage…</text>}
      {!records.error && !records.loading && !hasEntries() && <text fg={theme.textMuted}>No providers available.</text>}
      {!records.error && !records.loading && hasEntries() && (
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          height={height()}
          flexDirection="column"
          gap={1}
          scrollbarOptions={{
            visible: false,
          }}
        >
          <For each={filteredRecords()}>{(record) => <UsageCard record={record} timePeriod={timePeriod()} />}</For>
        </scrollbox>
      )}
    </box>
  )
}

function getPeriodKey(period: ProviderUsage.TimePeriod): string {
  switch (period) {
    case "session":
      return "1"
    case "daily":
      return "2"
    case "weekly":
      return "3"
    case "monthly":
      return "4"
    default:
      return ""
  }
}

function UsageCard(props: { record: ProviderUsage.Record; timePeriod: ProviderUsage.TimePeriod }) {
  const { theme } = useTheme()
  const status = createMemo(() => describeStatus(props.record))
  const limits = createMemo(() => describeLimits(props.record.limits))

  const periodLabel = createMemo(() => {
    switch (props.timePeriod) {
      case "session":
        return "This Session"
      case "daily":
        return "Today"
      case "weekly":
        return "This Week"
      case "monthly":
        return "This Month"
      default:
        return ""
    }
  })

  const costLabel = createMemo(() => {
    switch (props.timePeriod) {
      case "session":
        return "Session Cost"
      case "daily":
        return "Daily Cost"
      case "weekly":
        return "Weekly Cost"
      case "monthly":
        return "Monthly Cost"
      default:
        return "Cost"
    }
  })

  return (
    <box border={["left"]} borderColor={status().color} paddingLeft={2} paddingBottom={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.record.providerName}
      </text>
      <Show when={props.timePeriod !== "session"}>
        <text fg={theme.textMuted}>Period: {periodLabel()}</text>
      </Show>
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
      <Show when={props.record.costSummary}>
        {(cost) => (
          <box>
            <text fg={theme.textMuted}>{costLabel()}</text>
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

function describeLimits(limits: ProviderUsage.Record["limits"]): { label: string; detail: string; reset?: string }[] {
  if (!limits) return []
  const rows: { label: string; detail: string; reset?: string }[] = []
  const primary = describeLimit("Primary", limits.primary)
  if (primary) rows.push(primary)
  const secondary = describeLimit("Secondary", limits.secondary)
  if (secondary) rows.push(secondary)
  return rows
}

function describeLimit(
  label: string,
  window?: ProviderUsage.RateLimitWindowSummary,
): { label: string; detail: string; reset?: string } | undefined {
  if (!window) return undefined
  const remaining = typeof window.usedPercent === "number" ? Math.max(0, 100 - window.usedPercent) : undefined
  const detail = remaining === undefined ? "usage unknown" : `${remaining.toFixed(0)}% left ${progressBar(remaining)}`
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
