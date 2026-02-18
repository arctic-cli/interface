import { Session } from "@/session"
import { Storage } from "@/storage/storage"
import { Project } from "@/project/project"
import { Pricing } from "@/provider/pricing"
import { TextAttributes, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createMemo, createResource, createSignal, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"

interface SessionStats {
  totalSessions: number
  totalTokens: number
  totalCost: number
  activeDays: number
  longestStreak: number
  currentStreak: number
  longestSession: number
  peakHour: number
  modelUsage: Record<string, { count: number; tokens: number; cost: number }>
  dailyActivity: Record<string, number>
  dailyCost: Record<string, number>
  hourlyActivity: Record<number, number>
  tokenBreakdown: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
  costBreakdown: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
  costPerDay: number
  costPerSession: number
}

const WAR_AND_PEACE_TOKENS = 730000

type DateFilterType = "all" | "today" | "yesterday" | "7days" | "30days"

interface DateFilter {
  type: DateFilterType
  from: Date
  to: Date
  label: string
}

function getDateFilter(type: DateFilterType): DateFilter {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endOfToday = new Date(today)
  endOfToday.setHours(23, 59, 59, 999)

  switch (type) {
    case "today":
      return { type, from: today, to: endOfToday, label: "Today" }
    case "yesterday": {
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      const endOfYesterday = new Date(yesterday)
      endOfYesterday.setHours(23, 59, 59, 999)
      return { type, from: yesterday, to: endOfYesterday, label: "Yesterday" }
    }
    case "7days": {
      const weekAgo = new Date(today)
      weekAgo.setDate(weekAgo.getDate() - 6)
      return { type, from: weekAgo, to: endOfToday, label: "Last 7 days" }
    }
    case "30days": {
      const monthAgo = new Date(today)
      monthAgo.setDate(monthAgo.getDate() - 29)
      return { type, from: monthAgo, to: endOfToday, label: "Last 30 days" }
    }
    default:
      return { type: "all", from: new Date(0), to: endOfToday, label: "All time" }
  }
}

export function DialogStats() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const [tab, setTab] = createSignal<"overview" | "models" | "cost">("overview")
  const [dateFilterType, setDateFilterType] = createSignal<DateFilterType>("all")

  let scroll: ScrollBoxRenderable

  const tabs: Array<"overview" | "models" | "cost"> = ["overview", "models", "cost"]
  const dateFilters: DateFilterType[] = ["all", "today", "yesterday", "7days", "30days"]

  const dateFilter = createMemo(() => getDateFilter(dateFilterType()))

  useKeyboard((evt) => {
    if (evt.name === "tab" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      const currentIndex = tabs.indexOf(tab())
      const nextIndex = evt.shift
        ? (currentIndex - 1 + tabs.length) % tabs.length
        : (currentIndex + 1) % tabs.length
      setTab(tabs[nextIndex])
      return
    }
    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      const currentIndex = dateFilters.indexOf(dateFilterType())
      const nextIndex = (currentIndex - 1 + dateFilters.length) % dateFilters.length
      setDateFilterType(dateFilters[nextIndex])
      return
    }
    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      const currentIndex = dateFilters.indexOf(dateFilterType())
      const nextIndex = (currentIndex + 1) % dateFilters.length
      setDateFilterType(dateFilters[nextIndex])
      return
    }
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
  })

  onMount(() => {
    dialog.setSize("xlarge")
  })

  const [stats] = createResource(dateFilter, async (filter) => {
    return aggregateStats(filter.type === "all" ? undefined : filter)
  })

  const favoriteModel = createMemo(() => {
    const s = stats()
    if (!s || Object.keys(s.modelUsage).length === 0) return undefined
    const sorted = Object.entries(s.modelUsage).sort(([, a], [, b]) => b.tokens - a.tokens)
    return sorted[0]?.[0]
  })

  const tokenComparison = createMemo(() => {
    const s = stats()
    if (!s) return undefined
    const multiple = s.totalTokens / WAR_AND_PEACE_TOKENS
    if (multiple < 1) return undefined
    return Math.round(multiple)
  })

  const height = createMemo(() => {
    return Math.min(25, Math.floor(dimensions().height * 0.8))
  })

  const daysToShow = createMemo(() => {
    const s = stats()
    if (!s) return 90
    const keys = Object.keys(s.dailyActivity)
    if (keys.length === 0) return 90
    const earliest = Math.min(...keys.map((k) => new Date(k).getTime()))
    const diff = Math.ceil((Date.now() - earliest) / (24 * 60 * 60 * 1000))
    return Math.max(diff, 90)
  })

  const isFiltered = createMemo(() => dateFilterType() !== "all")

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <box flexDirection="row" gap={2}>
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={tab() === "overview" ? theme.primary : undefined}
            onMouseUp={() => setTab("overview")}
          >
            <text
              fg={tab() === "overview" ? "#ffffff" : theme.text}
              attributes={tab() === "overview" ? TextAttributes.BOLD : undefined}
            >
              Overview
            </text>
          </box>
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={tab() === "models" ? theme.primary : undefined}
            onMouseUp={() => setTab("models")}
          >
            <text
              fg={tab() === "models" ? "#ffffff" : theme.text}
              attributes={tab() === "models" ? TextAttributes.BOLD : undefined}
            >
              Models
            </text>
          </box>
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={tab() === "cost" ? theme.primary : undefined}
            onMouseUp={() => setTab("cost")}
          >
            <text
              fg={tab() === "cost" ? "#ffffff" : theme.text}
              attributes={tab() === "cost" ? TextAttributes.BOLD : undefined}
            >
              Cost
            </text>
          </box>
          <text fg={theme.textMuted}>(tab to cycle)</text>
        </box>
        <box flexDirection="row" gap={2}>
          <box flexDirection="row">
            <text fg={theme.textMuted}>◀ </text>
            <For each={dateFilters}>
              {(filter) => (
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={dateFilterType() === filter ? theme.accent : undefined}
                  onMouseUp={() => setDateFilterType(filter)}
                >
                  <text
                    fg={dateFilterType() === filter ? "#ffffff" : theme.textMuted}
                    attributes={dateFilterType() === filter ? TextAttributes.BOLD : undefined}
                  >
                    {getDateFilter(filter).label}
                  </text>
                </box>
              )}
            </For>
            <text fg={theme.textMuted}> ▶</text>
          </box>
        </box>
      </box>
      <text fg={theme.textMuted} paddingBottom={1}>
        ←/→ change date filter · esc to close
      </text>

      <Show when={stats.loading}>
        <text fg={theme.textMuted}>Loading stats...</text>
      </Show>

      <Show when={stats.error}>
        <text fg={theme.error}>Error loading stats: {String(stats.error)}</text>
      </Show>

      <Show when={stats() && tab() === "overview"}>
        <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} height={height()} scrollbarOptions={{ visible: false }}>
          <box gap={1}>
            <Show when={!isFiltered()}>
              <ActivityHeatmap dailyActivity={stats()!.dailyActivity} days={daysToShow()} />
            </Show>

            <box flexDirection="row" gap={4}>
              <box>
                <text fg={theme.text}>
                  <b>Favorite model:</b>{" "}
                  <span style={{ fg: theme.primary }}>{favoriteModel() ?? "N/A"}</span>
                </text>
              </box>
              <box>
                <text fg={theme.text}>
                  <b>Total tokens:</b>{" "}
                  <span style={{ fg: theme.primary }}>{formatNumber(stats()!.totalTokens)}</span>
                </text>
              </box>
            </box>

            <box flexDirection="row" gap={4}>
              <box>
                <text fg={theme.text}>
                  <b>Sessions:</b> <span style={{ fg: theme.primary }}>{stats()!.totalSessions}</span>
                </text>
                <Show when={!isFiltered()}>
                  <text fg={theme.text}>
                    <b>Current streak:</b>{" "}
                    <span style={{ fg: theme.primary }}>{stats()!.currentStreak} days</span>
                  </text>
                </Show>
                <text fg={theme.text}>
                  <b>Active days:</b>{" "}
                  <span style={{ fg: theme.primary }}>
                    {stats()!.activeDays}{!isFiltered() && `/${daysToShow()}`}
                  </span>
                </text>
              </box>
              <box>
                <text fg={theme.text}>
                  <b>Longest session:</b>{" "}
                  <span style={{ fg: theme.primary }}>{formatDuration(stats()!.longestSession)}</span>
                </text>
                <Show when={!isFiltered()}>
                  <text fg={theme.text}>
                    <b>Longest streak:</b>{" "}
                    <span style={{ fg: theme.primary }}>{stats()!.longestStreak} days</span>
                  </text>
                </Show>
                <text fg={theme.text}>
                  <b>Peak hour:</b>{" "}
                  <span style={{ fg: theme.primary }}>{formatHourRange(stats()!.peakHour)}</span>
                </text>
              </box>
            </box>

            <Show when={tokenComparison()}>
              <text fg={theme.primary}>
                You've used ~{tokenComparison()}x more tokens than War and Peace
              </text>
            </Show>

            <Show when={!isFiltered()}>
              <text fg={theme.textMuted}>Stats from the last {daysToShow()} days</text>
            </Show>
          </box>
        </scrollbox>
      </Show>

      <Show when={stats() && tab() === "models"}>
        <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} height={height()} scrollbarOptions={{ visible: false }}>
          <box gap={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Model Usage
            </text>
            <ModelUsageList modelUsage={stats()!.modelUsage} />
          </box>
        </scrollbox>
      </Show>

      <Show when={stats() && tab() === "cost"}>
        <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} height={height()} scrollbarOptions={{ visible: false }}>
          <box gap={1}>
            <CostOverview stats={stats()!} daysToShow={daysToShow()} isFiltered={isFiltered()} />
          </box>
        </scrollbox>
      </Show>
    </box>
  )
}

function ActivityHeatmap(props: { dailyActivity: Record<string, number>; days: number }) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const heatmapData = createMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const maxValue = Math.max(1, ...Object.values(props.dailyActivity))
    const weeks: { date: Date; value: number; level: number }[][] = []

    // calculate how many weeks we can fit based on terminal width
    const availableWidth = Math.min(dimensions().width - 10, 80)
    const weeksToShow = Math.min(Math.ceil(props.days / 7), Math.floor(availableWidth / 2))
    const daysToShow = weeksToShow * 7

    // find the start date (should start on Sunday for alignment)
    const endDate = new Date(today)
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() - daysToShow + 1)

    // adjust to start on a Sunday
    const dayOfWeek = startDate.getDay()
    if (dayOfWeek !== 0) {
      startDate.setDate(startDate.getDate() - dayOfWeek)
    }

    let currentDate = new Date(startDate)
    let currentWeek: { date: Date; value: number; level: number }[] = []

    while (currentDate <= endDate) {
      const dateKey = currentDate.toISOString().split("T")[0]
      const value = props.dailyActivity[dateKey] || 0
      const level = value === 0 ? 0 : Math.min(4, Math.ceil((value / maxValue) * 4))

      if (currentDate.getDay() === 0 && currentWeek.length > 0) {
        weeks.push(currentWeek)
        currentWeek = []
      }

      currentWeek.push({ date: new Date(currentDate), value, level })
      currentDate.setDate(currentDate.getDate() + 1)
    }

    if (currentWeek.length > 0) {
      weeks.push(currentWeek)
    }

    return { weeks, weeksToShow }
  })

  const monthLabels = createMemo(() => {
    const data = heatmapData()
    const labels: { month: string; position: number }[] = []
    let lastMonth = -1

    for (let i = 0; i < data.weeks.length; i++) {
      const week = data.weeks[i]
      if (!week || week.length === 0) continue
      const firstDay = week[0].date
      const month = firstDay.getMonth()
      if (month !== lastMonth) {
        labels.push({
          month: firstDay.toLocaleString("en-US", { month: "short" }),
          position: i,
        })
        lastMonth = month
      }
    }

    return labels
  })

  const levelColors = createMemo(() => [
    "#2d333b",
    "#0e4429",
    "#006d32",
    "#26a641",
    "#39d353",
  ])

  return (
    <box>
      {/* month labels */}
      <box flexDirection="row" paddingLeft={4}>
        <For each={monthLabels()}>
          {(label, i) => {
            const nextLabel = monthLabels()[i() + 1]
            const width = nextLabel
              ? (nextLabel.position - label.position) * 2
              : (heatmapData().weeks.length - label.position) * 2
            return (
              <box width={Math.max(width, 3)}>
                <text fg={theme.textMuted}>{label.month}</text>
              </box>
            )
          }}
        </For>
      </box>

      {/* heatmap grid */}
      <For each={[0, 1, 2, 3, 4, 5, 6]}>
        {(dayOfWeek) => (
          <box flexDirection="row">
            <box width={4}>
              <text fg={theme.textMuted}>
                {dayOfWeek === 1 ? "Mon" : dayOfWeek === 3 ? "Wed" : dayOfWeek === 5 ? "Fri" : "   "}
              </text>
            </box>
            <box flexDirection="row">
              <For each={heatmapData().weeks}>
                {(week) => {
                  const day = week.find((d) => d.date.getDay() === dayOfWeek)
                  if (!day) {
                    return <text fg="#2d333b">{"■ "}</text>
                  }
                  const colors = levelColors()
                  const color = colors[day.level]
                  return <text fg={color}>{"■ "}</text>
                }}
              </For>
            </box>
          </box>
        )}
      </For>

      {/* legend */}
      <box flexDirection="row" paddingTop={1} paddingLeft={4}>
        <text fg={theme.textMuted}>Less </text>
        <For each={levelColors()}>
          {(color) => <text fg={color}>■ </text>}
        </For>
        <text fg={theme.textMuted}>More</text>
      </box>
    </box>
  )
}

function ModelUsageList(props: { modelUsage: Record<string, { count: number; tokens: number; cost: number }> }) {
  const { theme } = useTheme()

  const sortedModels = createMemo(() => {
    return Object.entries(props.modelUsage)
      .sort(([, a], [, b]) => b.tokens - a.tokens)
      .slice(0, 10)
  })

  const maxTokens = createMemo(() => {
    const models = sortedModels()
    if (models.length === 0) return 1
    return Math.max(1, models[0][1].tokens)
  })

  return (
    <box>
      <For each={sortedModels()}>
        {([model, usage]) => {
          const barLength = Math.max(1, Math.floor((usage.tokens / maxTokens()) * 30))
          const bar = "█".repeat(barLength)
          return (
            <box flexDirection="row" gap={2}>
              <box width={40}>
                <text fg={theme.text} wrapMode="none">
                  {truncateModel(model, 38)}
                </text>
              </box>
              <text fg={theme.primary}>{bar}</text>
              <text fg={theme.textMuted}>
                {usage.count}× · {formatNumber(usage.tokens)} tokens · {formatCurrency(usage.cost)}
              </text>
            </box>
          )
        }}
      </For>
      <Show when={sortedModels().length === 0}>
        <text fg={theme.textMuted}>No model usage data available</text>
      </Show>
    </box>
  )
}

function CostOverview(props: { stats: SessionStats; daysToShow: number; isFiltered: boolean }) {
  const { theme } = useTheme()

  const topModelsByCost = createMemo(() => {
    return Object.entries(props.stats.modelUsage)
      .sort(([, a], [, b]) => b.cost - a.cost)
      .slice(0, 5)
  })

  const maxCost = createMemo(() => {
    const models = topModelsByCost()
    if (models.length === 0) return 1
    return Math.max(0.01, models[0][1].cost)
  })

  return (
    <box gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Cost Summary
      </text>

      <box flexDirection="row" gap={4}>
        <box>
          <text fg={theme.text}>
            <b>Total cost:</b>{" "}
            <span style={{ fg: "#fbbf24" }}>{formatCurrency(props.stats.totalCost)}</span>
          </text>
          <text fg={theme.text}>
            <b>Avg cost/day:</b>{" "}
            <span style={{ fg: "#fbbf24" }}>{formatCurrency(props.stats.costPerDay)}</span>
          </text>
          <text fg={theme.text}>
            <b>Avg cost/session:</b>{" "}
            <span style={{ fg: "#fbbf24" }}>{formatCurrency(props.stats.costPerSession)}</span>
          </text>
        </box>
        <box>
          <text fg={theme.text}>
            <b>Sessions:</b> <span style={{ fg: theme.primary }}>{props.stats.totalSessions}</span>
          </text>
          <text fg={theme.text}>
            <b>Active days:</b>{" "}
            <span style={{ fg: theme.primary }}>
              {props.stats.activeDays}{!props.isFiltered && `/${props.daysToShow}`}
            </span>
          </text>
        </box>
      </box>

      <text fg={theme.text} attributes={TextAttributes.BOLD} paddingTop={1}>
        Token Breakdown
      </text>
      <box marginLeft={2}>
        <text fg={theme.text}>
          <b>Input:</b>{" "}
          <span style={{ fg: "#60a5fa" }}>{formatNumber(props.stats.tokenBreakdown.input)}</span>
          {" · "}
          <span style={{ fg: "#fbbf24" }}>{formatCurrency(props.stats.costBreakdown.input)}</span>
        </text>
        <text fg={theme.text}>
          <b>Output:</b>{" "}
          <span style={{ fg: "#f472b6" }}>{formatNumber(props.stats.tokenBreakdown.output)}</span>
          {" · "}
          <span style={{ fg: "#fbbf24" }}>{formatCurrency(props.stats.costBreakdown.output)}</span>
        </text>
        <text fg={theme.text}>
          <b>Cache read:</b>{" "}
          <span style={{ fg: "#a78bfa" }}>{formatNumber(props.stats.tokenBreakdown.cacheRead)}</span>
          {" · "}
          <span style={{ fg: "#fbbf24" }}>{formatCurrency(props.stats.costBreakdown.cacheRead)}</span>
        </text>
        <text fg={theme.text}>
          <b>Cache write:</b>{" "}
          <span style={{ fg: "#c084fc" }}>{formatNumber(props.stats.tokenBreakdown.cacheWrite)}</span>
          {" · "}
          <span style={{ fg: "#fbbf24" }}>{formatCurrency(props.stats.costBreakdown.cacheWrite)}</span>
        </text>
      </box>

      <text fg={theme.text} attributes={TextAttributes.BOLD} paddingTop={1}>
        Top Models by Cost
      </text>
      <box>
        <For each={topModelsByCost()}>
          {([model, usage]) => {
            const barLength = Math.max(1, Math.floor((usage.cost / maxCost()) * 25))
            const bar = "█".repeat(barLength)
            return (
              <box flexDirection="row" gap={2}>
                <box width={35}>
                  <text fg={theme.text} wrapMode="none">
                    {truncateModel(model, 33)}
                  </text>
                </box>
                <text fg="#fbbf24">{bar}</text>
                <text fg={theme.textMuted}>
                  {formatCurrency(usage.cost)} · {formatNumber(usage.tokens)} tokens
                </text>
              </box>
            )
          }}
        </For>
        <Show when={topModelsByCost().length === 0}>
          <text fg={theme.textMuted}>No cost data available</text>
        </Show>
      </box>

      <Show when={!props.isFiltered}>
        <text fg={theme.textMuted} paddingTop={1}>
          Stats from the last {props.daysToShow} days
        </text>
      </Show>
    </box>
  )
}

async function aggregateStats(dateFilter?: DateFilter): Promise<SessionStats> {
  const allSessions = await getAllSessions()

  const sessions = dateFilter
    ? allSessions.filter((session) => {
        const created = new Date(session.time.created)
        return created >= dateFilter.from && created <= dateFilter.to
      })
    : allSessions

  const stats: SessionStats = {
    totalSessions: sessions.length,
    totalTokens: 0,
    totalCost: 0,
    activeDays: 0,
    longestStreak: 0,
    currentStreak: 0,
    longestSession: 0,
    peakHour: 12,
    modelUsage: {},
    dailyActivity: {},
    dailyCost: {},
    hourlyActivity: {},
    tokenBreakdown: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    costBreakdown: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    costPerDay: 0,
    costPerSession: 0,
  }

  if (sessions.length === 0) return stats

  const activeDaysSet = new Set<string>()

  for (const session of sessions) {
    const duration = session.time.updated - session.time.created
    if (duration > stats.longestSession) {
      stats.longestSession = duration
    }

    const dateKey = new Date(session.time.created).toISOString().split("T")[0]
    activeDaysSet.add(dateKey)

    const hour = new Date(session.time.created).getHours()
    stats.hourlyActivity[hour] = (stats.hourlyActivity[hour] || 0) + 1
  }

  // process messages in batches
  const BATCH_SIZE = 20
  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const batch = sessions.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (session) => {
        const messages = await Session.messages({ sessionID: session.id })
        let sessionTokens = 0
        let sessionCost = 0
        const sessionModelUsage: Record<string, { count: number; tokens: number; cost: number }> = {}
        const sessionTokenBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        const sessionCostBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

        for (const message of messages) {
          if (message.info.role === "assistant") {
            const modelID = message.info.modelID
            const tokens = message.info.tokens

            if (tokens) {
              const input = tokens.input || 0
              const output = tokens.output || 0
              const reasoning = tokens.reasoning || 0
              const cacheRead = tokens.cache?.read || 0
              const cacheWrite = tokens.cache?.write || 0
              const total = input + output + reasoning + cacheRead + cacheWrite

              sessionTokens += total
              sessionTokenBreakdown.input += input
              sessionTokenBreakdown.output += output + reasoning
              sessionTokenBreakdown.cacheRead += cacheRead
              sessionTokenBreakdown.cacheWrite += cacheWrite

              // calculate cost
              let messageCost = 0
              if (modelID) {
                const costBreakdown = await Pricing.calculateCostAsync(modelID, {
                  input,
                  output: output + reasoning,
                  cacheCreation: cacheWrite,
                  cacheRead,
                })

                if (costBreakdown) {
                  messageCost = costBreakdown.totalCost
                  sessionCostBreakdown.input += costBreakdown.inputCost
                  sessionCostBreakdown.output += costBreakdown.outputCost
                  sessionCostBreakdown.cacheRead += costBreakdown.cacheReadCost
                  sessionCostBreakdown.cacheWrite += costBreakdown.cacheCreationCost
                }

                if (!sessionModelUsage[modelID]) {
                  sessionModelUsage[modelID] = { count: 0, tokens: 0, cost: 0 }
                }
                sessionModelUsage[modelID].count++
                sessionModelUsage[modelID].tokens += total
                sessionModelUsage[modelID].cost += messageCost
              }

              sessionCost += messageCost
            }
          }
        }

        const dateKey = new Date(session.time.created).toISOString().split("T")[0]
        return { sessionTokens, sessionCost, sessionModelUsage, sessionTokenBreakdown, sessionCostBreakdown, dateKey }
      }),
    )

    for (const result of batchResults) {
      stats.totalTokens += result.sessionTokens
      stats.totalCost += result.sessionCost
      stats.dailyActivity[result.dateKey] = (stats.dailyActivity[result.dateKey] || 0) + result.sessionTokens
      stats.dailyCost[result.dateKey] = (stats.dailyCost[result.dateKey] || 0) + result.sessionCost

      stats.tokenBreakdown.input += result.sessionTokenBreakdown.input
      stats.tokenBreakdown.output += result.sessionTokenBreakdown.output
      stats.tokenBreakdown.cacheRead += result.sessionTokenBreakdown.cacheRead
      stats.tokenBreakdown.cacheWrite += result.sessionTokenBreakdown.cacheWrite

      stats.costBreakdown.input += result.sessionCostBreakdown.input
      stats.costBreakdown.output += result.sessionCostBreakdown.output
      stats.costBreakdown.cacheRead += result.sessionCostBreakdown.cacheRead
      stats.costBreakdown.cacheWrite += result.sessionCostBreakdown.cacheWrite

      for (const [model, usage] of Object.entries(result.sessionModelUsage)) {
        if (!stats.modelUsage[model]) {
          stats.modelUsage[model] = { count: 0, tokens: 0, cost: 0 }
        }
        stats.modelUsage[model].count += usage.count
        stats.modelUsage[model].tokens += usage.tokens
        stats.modelUsage[model].cost += usage.cost
      }
    }
  }

  // calculate streaks
  const sortedDates = Array.from(activeDaysSet).sort()
  stats.activeDays = sortedDates.length

  if (sortedDates.length > 0) {
    let currentStreak = 1
    let longestStreak = 1
    let streak = 1

    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1])
      const curr = new Date(sortedDates[i])
      const diff = (curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000)

      if (diff === 1) {
        streak++
        if (streak > longestStreak) longestStreak = streak
      } else {
        streak = 1
      }
    }

    stats.longestStreak = longestStreak

    // calculate current streak from today
    const today = new Date().toISOString().split("T")[0]
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0]

    if (activeDaysSet.has(today) || activeDaysSet.has(yesterday)) {
      currentStreak = 1
      let checkDate = new Date(activeDaysSet.has(today) ? today : yesterday)

      while (true) {
        checkDate.setDate(checkDate.getDate() - 1)
        const checkKey = checkDate.toISOString().split("T")[0]
        if (activeDaysSet.has(checkKey)) {
          currentStreak++
        } else {
          break
        }
      }
    }

    stats.currentStreak = currentStreak
  }

  // find peak hour
  let maxHourActivity = 0
  for (const [hour, count] of Object.entries(stats.hourlyActivity)) {
    if (count > maxHourActivity) {
      maxHourActivity = count
      stats.peakHour = parseInt(hour)
    }
  }

  // calculate averages
  if (stats.activeDays > 0) {
    stats.costPerDay = stats.totalCost / stats.activeDays
  }
  if (stats.totalSessions > 0) {
    stats.costPerSession = stats.totalCost / stats.totalSessions
  }

  return stats
}

async function getAllSessions(): Promise<Session.Info[]> {
  const sessions: Session.Info[] = []

  const projectKeys = await Storage.list(["project"])
  const projects = await Promise.all(projectKeys.map((key) => Storage.read<Project.Info>(key)))

  for (const project of projects) {
    if (!project) continue

    const sessionKeys = await Storage.list(["session", project.id])
    const projectSessions = await Promise.all(sessionKeys.map((key) => Storage.read<Session.Info>(key)))

    for (const session of projectSessions) {
      if (session) {
        sessions.push(session)
      }
    }
  }

  return sessions
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "m"
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "k"
  }
  return num.toString()
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    const remainingSeconds = seconds % 60
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${seconds}s`
}

function formatHourRange(hour: number): string {
  const start = hour.toString().padStart(2, "0")
  const end = ((hour + 1) % 24).toString().padStart(2, "0")
  return `${start}:00-${end}:00`
}

function truncateModel(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name
  return name.slice(0, maxLength - 2) + ".."
}

function formatCurrency(amount: number): string {
  if (amount === 0) return "$0.00"
  if (amount < 0.00001) return "<$0.00001"
  if (amount < 0.01) return `$${amount.toFixed(5)}`
  if (amount < 1) return `$${amount.toFixed(3)}`
  return `$${amount.toFixed(2)}`
}
