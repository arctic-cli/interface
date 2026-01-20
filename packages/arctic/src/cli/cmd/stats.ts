import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { bootstrap } from "../bootstrap"
import { Storage } from "../../storage/storage"
import { Project } from "../../project/project"
import { Pricing } from "../../provider/pricing"

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

// ansi color codes
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  primary: "\x1b[38;5;75m", // blue
  yellow: "\x1b[38;5;220m",
  pink: "\x1b[38;5;213m",
  purple: "\x1b[38;5;141m",
  green: "\x1b[38;5;120m",
  muted: "\x1b[38;5;245m",
  white: "\x1b[38;5;255m",
  // heatmap colors
  heat0: "\x1b[38;5;236m",
  heat1: "\x1b[38;5;22m",
  heat2: "\x1b[38;5;28m",
  heat3: "\x1b[38;5;34m",
  heat4: "\x1b[38;5;82m",
}

export const StatsCommand = cmd({
  command: "stats",
  describe: "show token usage and cost statistics",
  builder: (yargs: Argv) => {
    return yargs
      .option("view", {
        describe: "which view to display",
        choices: ["all", "overview", "models", "cost"] as const,
        default: "all" as "all" | "overview" | "models" | "cost",
      })
      .option("json", {
        alias: "j",
        describe: "output as JSON",
        type: "boolean",
        default: false,
      })
      .option("date", {
        alias: "d",
        describe: "filter by date (today, yesterday, or YYYY-MM-DD)",
        type: "string",
      })
      .option("from", {
        describe: "start date for range filter (YYYY-MM-DD)",
        type: "string",
      })
      .option("to", {
        describe: "end date for range filter (YYYY-MM-DD)",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const dateFilter = parseDateFilter(args.date as string | undefined, args.from as string | undefined, args.to as string | undefined)
      const stats = await aggregateStats(dateFilter)

      if (args.json) {
        console.log(JSON.stringify(stats, null, 2))
        return
      }

      const view = args.view as "all" | "overview" | "models" | "cost"
      displayStats(stats, view, dateFilter)
    })
  },
})

interface DateFilter {
  from: Date
  to: Date
  label: string
}

function parseDateFilter(date?: string, from?: string, to?: string): DateFilter | undefined {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (date) {
    if (date === "today") {
      const end = new Date(today)
      end.setHours(23, 59, 59, 999)
      return { from: today, to: end, label: "today" }
    }
    if (date === "yesterday") {
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      const end = new Date(yesterday)
      end.setHours(23, 59, 59, 999)
      return { from: yesterday, to: end, label: "yesterday" }
    }
    const parsed = new Date(date)
    if (!isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0)
      const end = new Date(parsed)
      end.setHours(23, 59, 59, 999)
      return { from: parsed, to: end, label: date }
    }
    console.error(`Invalid date format: ${date}. Use "today", "yesterday", or YYYY-MM-DD`)
    process.exit(1)
  }

  if (from || to) {
    const fromDate = from ? new Date(from) : new Date(0)
    const toDate = to ? new Date(to) : new Date()

    if (from && isNaN(fromDate.getTime())) {
      console.error(`Invalid from date: ${from}. Use YYYY-MM-DD format`)
      process.exit(1)
    }
    if (to && isNaN(toDate.getTime())) {
      console.error(`Invalid to date: ${to}. Use YYYY-MM-DD format`)
      process.exit(1)
    }

    fromDate.setHours(0, 0, 0, 0)
    toDate.setHours(23, 59, 59, 999)

    const label = from && to ? `${from} to ${to}` : from ? `from ${from}` : `until ${to}`
    return { from: fromDate, to: toDate, label }
  }

  return undefined
}

function displayStats(stats: SessionStats, view: "all" | "overview" | "models" | "cost", dateFilter?: DateFilter) {
  const daysToShow = calculateDaysToShow(stats)
  const favoriteModel = getFavoriteModel(stats)
  const tokenComparison = getTokenComparison(stats)

  console.log()

  if (dateFilter) {
    console.log(`${colors.bold}Showing stats for: ${colors.primary}${dateFilter.label}${colors.reset}`)
    console.log()
  }

  if (view === "all" || view === "overview") {
    if (!dateFilter) {
      renderActivityHeatmap(stats.dailyActivity, daysToShow)
      console.log()
    }

    // favorite model and total tokens row
    const favModelText = `${colors.bold}Favorite model:${colors.reset} ${colors.primary}${favoriteModel ?? "N/A"}${colors.reset}`
    const totalTokensText = `${colors.bold}Total tokens:${colors.reset} ${colors.primary}${formatNumber(stats.totalTokens)}${colors.reset}`
    console.log(`${favModelText}    ${totalTokensText}`)
    console.log()

    // two column stats
    const col1 = [
      `${colors.bold}Sessions:${colors.reset} ${colors.primary}${stats.totalSessions}${colors.reset}`,
      `${colors.bold}Current streak:${colors.reset} ${colors.primary}${stats.currentStreak} days${colors.reset}`,
      `${colors.bold}Active days:${colors.reset} ${colors.primary}${stats.activeDays}${dateFilter ? "" : `/${daysToShow}`}${colors.reset}`,
    ]
    const col2 = [
      `${colors.bold}Longest session:${colors.reset} ${colors.primary}${formatDuration(stats.longestSession)}${colors.reset}`,
      `${colors.bold}Longest streak:${colors.reset} ${colors.primary}${stats.longestStreak} days${colors.reset}`,
      `${colors.bold}Peak hour:${colors.reset} ${colors.primary}${formatHourRange(stats.peakHour)}${colors.reset}`,
    ]

    for (let i = 0; i < col1.length; i++) {
      console.log(`${col1[i].padEnd(50)}${col2[i]}`)
    }

    if (tokenComparison) {
      console.log()
      console.log(`${colors.primary}You've used ~${tokenComparison}x more tokens than War and Peace${colors.reset}`)
    }

    if (!dateFilter) {
      console.log()
      console.log(`${colors.muted}Stats from the last ${daysToShow} days${colors.reset}`)
    }
    console.log()
  }

  if (view === "all" || view === "models") {
    renderModelUsage(stats.modelUsage)
    console.log()
  }

  if (view === "all" || view === "cost") {
    renderCostOverview(stats, daysToShow, dateFilter)
    console.log()
  }
}

function renderActivityHeatmap(dailyActivity: Record<string, number>, days: number) {
  const termWidth = process.stdout.columns || 80
  const availableWidth = Math.min(termWidth - 10, 80)
  const weeksToShow = Math.min(Math.ceil(days / 7), Math.floor(availableWidth / 2))
  const daysToShow = weeksToShow * 7

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - daysToShow + 1)

  // adjust to start on Sunday
  const dayOfWeek = startDate.getDay()
  if (dayOfWeek !== 0) {
    startDate.setDate(startDate.getDate() - dayOfWeek)
  }

  const maxValue = Math.max(1, ...Object.values(dailyActivity))

  // build weeks array
  const weeks: { date: Date; value: number; level: number }[][] = []
  let currentDate = new Date(startDate)
  let currentWeek: { date: Date; value: number; level: number }[] = []

  while (currentDate <= today) {
    const dateKey = currentDate.toISOString().split("T")[0]
    const value = dailyActivity[dateKey] || 0
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

  // month labels
  const monthLabels: { month: string; position: number }[] = []
  let lastMonth = -1
  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i]
    if (!week || week.length === 0) continue
    const firstDay = week[0].date
    const month = firstDay.getMonth()
    if (month !== lastMonth) {
      monthLabels.push({
        month: firstDay.toLocaleString("en-US", { month: "short" }),
        position: i,
      })
      lastMonth = month
    }
  }

  // render month labels
  let monthLine = "    "
  for (let i = 0; i < monthLabels.length; i++) {
    const label = monthLabels[i]
    const nextLabel = monthLabels[i + 1]
    const width = nextLabel ? (nextLabel.position - label.position) * 2 : (weeks.length - label.position) * 2
    monthLine += colors.muted + label.month.padEnd(Math.max(width, 3)) + colors.reset
  }
  console.log(monthLine)

  // render heatmap grid
  const levelColors = [colors.heat0, colors.heat1, colors.heat2, colors.heat3, colors.heat4]

  for (let dow = 0; dow < 7; dow++) {
    let line = ""
    if (dow === 1) line = colors.muted + "Mon " + colors.reset
    else if (dow === 3) line = colors.muted + "Wed " + colors.reset
    else if (dow === 5) line = colors.muted + "Fri " + colors.reset
    else line = "    "

    for (const week of weeks) {
      const day = week.find((d) => d.date.getDay() === dow)
      if (!day) {
        line += colors.heat0 + "■ " + colors.reset
      } else {
        line += levelColors[day.level] + "■ " + colors.reset
      }
    }
    console.log(line)
  }

  // legend
  console.log()
  let legend = "    " + colors.muted + "Less " + colors.reset
  for (const c of levelColors) {
    legend += c + "■ " + colors.reset
  }
  legend += colors.muted + "More" + colors.reset
  console.log(legend)
}

function renderModelUsage(modelUsage: Record<string, { count: number; tokens: number; cost: number }>) {
  console.log(`${colors.bold}Model Usage${colors.reset}`)
  console.log()

  const sorted = Object.entries(modelUsage)
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .slice(0, 10)

  if (sorted.length === 0) {
    console.log(`${colors.muted}No model usage data available${colors.reset}`)
    return
  }

  const maxTokens = Math.max(1, sorted[0][1].tokens)

  for (const [model, usage] of sorted) {
    const barLength = Math.max(1, Math.floor((usage.tokens / maxTokens) * 30))
    const bar = "█".repeat(barLength)
    const truncated = truncateModel(model, 38)
    console.log(
      `${colors.white}${truncated.padEnd(40)}${colors.reset}${colors.primary}${bar}${colors.reset} ${colors.muted}${usage.count}× · ${formatNumber(usage.tokens)} tokens · ${formatCurrency(usage.cost)}${colors.reset}`,
    )
  }
}

function renderCostOverview(stats: SessionStats, daysToShow: number, dateFilter?: DateFilter) {
  console.log(`${colors.bold}Cost Summary${colors.reset}`)
  console.log()

  // two column layout
  const col1 = [
    `${colors.bold}Total cost:${colors.reset} ${colors.yellow}${formatCurrency(stats.totalCost)}${colors.reset}`,
    `${colors.bold}Avg cost/day:${colors.reset} ${colors.yellow}${formatCurrency(stats.costPerDay)}${colors.reset}`,
    `${colors.bold}Avg cost/session:${colors.reset} ${colors.yellow}${formatCurrency(stats.costPerSession)}${colors.reset}`,
  ]
  const col2 = [
    `${colors.bold}Sessions:${colors.reset} ${colors.primary}${stats.totalSessions}${colors.reset}`,
    `${colors.bold}Active days:${colors.reset} ${colors.primary}${stats.activeDays}${dateFilter ? "" : `/${daysToShow}`}${colors.reset}`,
    "",
  ]

  for (let i = 0; i < col1.length; i++) {
    if (col2[i]) {
      console.log(`${col1[i].padEnd(55)}${col2[i]}`)
    } else {
      console.log(col1[i])
    }
  }

  console.log()
  console.log(`${colors.bold}Token Breakdown${colors.reset}`)
  console.log(
    `  ${colors.bold}Input:${colors.reset} ${colors.primary}${formatNumber(stats.tokenBreakdown.input)}${colors.reset} · ${colors.yellow}${formatCurrency(stats.costBreakdown.input)}${colors.reset}`,
  )
  console.log(
    `  ${colors.bold}Output:${colors.reset} ${colors.pink}${formatNumber(stats.tokenBreakdown.output)}${colors.reset} · ${colors.yellow}${formatCurrency(stats.costBreakdown.output)}${colors.reset}`,
  )
  console.log(
    `  ${colors.bold}Cache read:${colors.reset} ${colors.purple}${formatNumber(stats.tokenBreakdown.cacheRead)}${colors.reset} · ${colors.yellow}${formatCurrency(stats.costBreakdown.cacheRead)}${colors.reset}`,
  )
  console.log(
    `  ${colors.bold}Cache write:${colors.reset} ${colors.purple}${formatNumber(stats.tokenBreakdown.cacheWrite)}${colors.reset} · ${colors.yellow}${formatCurrency(stats.costBreakdown.cacheWrite)}${colors.reset}`,
  )

  console.log()
  console.log(`${colors.bold}Top Models by Cost${colors.reset}`)

  const topByCost = Object.entries(stats.modelUsage)
    .sort(([, a], [, b]) => b.cost - a.cost)
    .slice(0, 5)

  if (topByCost.length === 0) {
    console.log(`${colors.muted}No cost data available${colors.reset}`)
    return
  }

  const maxCost = Math.max(0.01, topByCost[0][1].cost)

  for (const [model, usage] of topByCost) {
    const barLength = Math.max(1, Math.floor((usage.cost / maxCost) * 25))
    const bar = "█".repeat(barLength)
    const truncated = truncateModel(model, 33)
    console.log(
      `${colors.white}${truncated.padEnd(35)}${colors.reset}${colors.yellow}${bar}${colors.reset} ${colors.muted}${formatCurrency(usage.cost)} · ${formatNumber(usage.tokens)} tokens${colors.reset}`,
    )
  }

  if (!dateFilter) {
    console.log()
    console.log(`${colors.muted}Stats from the last ${daysToShow} days${colors.reset}`)
  }
}

function calculateDaysToShow(stats: SessionStats): number {
  const keys = Object.keys(stats.dailyActivity)
  if (keys.length === 0) return 90
  const earliest = Math.min(...keys.map((k) => new Date(k).getTime()))
  const diff = Math.ceil((Date.now() - earliest) / (24 * 60 * 60 * 1000))
  return Math.max(diff, 90)
}

function getFavoriteModel(stats: SessionStats): string | undefined {
  if (Object.keys(stats.modelUsage).length === 0) return undefined
  const sorted = Object.entries(stats.modelUsage).sort(([, a], [, b]) => b.tokens - a.tokens)
  return sorted[0]?.[0]
}

function getTokenComparison(stats: SessionStats): number | undefined {
  const multiple = stats.totalTokens / WAR_AND_PEACE_TOKENS
  if (multiple < 1) return undefined
  return Math.round(multiple)
}

async function aggregateStats(dateFilter?: DateFilter): Promise<SessionStats> {
  const allSessions = await getAllSessions()

  // filter sessions by date if filter is provided
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
        const messages = await Session.messages({ sessionID: session.id }).catch(() => [])
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
      let currentStreak = 1
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
      stats.currentStreak = currentStreak
    }
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
  const projects = await Promise.all(
    projectKeys.map((key) => Storage.read<Project.Info>(key).catch(() => undefined))
  )

  for (const project of projects) {
    if (!project) continue

    const sessionKeys = await Storage.list(["session", project.id])
    const projectSessions = await Promise.all(
      sessionKeys.map((key) => Storage.read<Session.Info>(key).catch(() => undefined))
    )

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
    return `${hours}h ${remainingMinutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m`
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
