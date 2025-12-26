export type RateLimitWindowSummary = {
  usedPercent: number | null
  windowMinutes?: number | null
  resetsAt?: number | null
}

export type CreditsSummary = {
  hasCredits: boolean
  unlimited: boolean
  balance?: string
}

export type CostSummary = {
  totalCost?: number
  inputCost?: number
  outputCost?: number
  cacheCreationCost?: number
  cacheReadCost?: number
}

export type UsageRecordSummary = {
  providerID: string
  providerName: string
  planType?: string
  allowed?: boolean
  limitReached?: boolean
  limits?: {
    primary?: RateLimitWindowSummary
    secondary?: RateLimitWindowSummary
  }
  credits?: CreditsSummary
  tokenUsage?: {
    total?: number
    input?: number
    output?: number
    cached?: number
    cacheCreation?: number
  }
  costSummary?: CostSummary
  fetchedAt: number
  error?: string
}

const BAR_SEGMENTS = 20
const BAR_FILLED = "█"
const BAR_EMPTY = "░"
const CARD_PADDING = 2
const HELP_URL = "https://chatgpt.com/codex/settings/usage"
const EXTRA_CARD_SPACE = 2

export function formatUsageSummary(records: UsageRecordSummary[], now = Date.now()): string {
  const content: string[] = []
  content.push(`Usage summary · ${new Date(now).toISOString()}`)
  content.push("")
  content.push(`Visit ${HELP_URL} for up-to-date`)
  content.push("information on rate limits and credits")

  if (records.length === 0) {
    content.push("")
    content.push("No providers are configured for usage tracking.")
    return renderCard(content)
  }

  records.forEach((record, index) => {
    const plan = record.planType ? ` (plan: ${record.planType})` : ""
    content.push("")
    content.push(`${record.providerName}${plan}`)

    if (record.error) {
      content.push(`  Error   : ${record.error}`)
      return
    }

    content.push(`  Access  : ${formatAccess(record)}`)
    if (record.credits) {
      content.push(`  Credits : ${formatCredits(record.credits)}`)
    }

    const tokensLine = formatTokenUsage(record.tokenUsage)
    if (tokensLine) {
      content.push(`  Tokens  : ${tokensLine}`)
    }

    const costLine = formatCost(record.costSummary)
    if (costLine) {
      content.push(`  Cost    : ${costLine}`)
    }

    const limitLines = formatLimits(record.limits, now)
    if (limitLines) {
      content.push("  Limits")
      content.push(...limitLines.map((line) => `    ${line}`))
    }

    if (index < records.length - 1) {
      content.push("")
      content.push("  ───────────────────────────────────────────────")
    }
  })

  return renderCard(content)
}

function renderCard(lines: string[]): string {
  const measuredWidth = Math.max(...lines.map((line) => line.length), 0)
  const contentWidth = measuredWidth + EXTRA_CARD_SPACE
  const horizontal = `╭${"─".repeat(contentWidth + CARD_PADDING * 2)}╮`
  const bottom = `╰${"─".repeat(contentWidth + CARD_PADDING * 2)}╯`
  const body = lines.map((line) => {
    const padded = line.padEnd(contentWidth, " ")
    return `│${" ".repeat(CARD_PADDING)}${padded}${" ".repeat(CARD_PADDING)}│`
  })
  return [horizontal, ...body, bottom].join("\n")
}

function formatAccess(record: UsageRecordSummary): string {
  if (record.allowed === false) {
    return record.limitReached ? "blocked, limit reached" : "blocked"
  }
  if (record.limitReached) return "allowed, limit reached"
  if (record.allowed === true) return "allowed"
  return "unknown"
}

function formatLimits(limits: UsageRecordSummary["limits"], now: number): string[] | undefined {
  if (!limits) return undefined
  const rows: string[] = []
  const primary = limitLine("Primary", limits.primary, now)
  if (primary) rows.push(primary)
  const secondary = limitLine("Secondary", limits.secondary, now)
  if (secondary) rows.push(secondary)
  if (rows.length === 0) return undefined
  return rows
}

function limitLine(label: string, window: RateLimitWindowSummary | undefined, now: number): string | undefined {
  if (!window) return undefined
  const remaining = formatRemaining(window)
  const reset = formatReset(window.resetsAt || undefined, now) ?? "reset unknown"
  return `${label.padEnd(9)} ${remaining}  ·  ${reset}  `
}

function formatRemaining(window: RateLimitWindowSummary): string {
  if (typeof window.usedPercent !== "number") {
    return "usage unknown"
  }
  const percentRemaining = Math.max(0, 100 - window.usedPercent)
  return `${formatPercent(percentRemaining)} left ${renderProgressBar(percentRemaining)}`
}

function renderProgressBar(percentRemaining: number): string {
  const ratio = Math.max(0, Math.min(100, percentRemaining)) / 100
  const filled = Math.round(ratio * BAR_SEGMENTS)
  const empty = BAR_SEGMENTS - filled
  return `[${BAR_FILLED.repeat(filled)}${BAR_EMPTY.repeat(empty)}]`
}

function formatReset(resetsAtSeconds: number | undefined, now: number): string | undefined {
  if (!resetsAtSeconds) return undefined
  const resetDate = new Date(resetsAtSeconds * 1000)
  const diffMinutes = Math.max(0, Math.round((resetDate.getTime() - now) / 60000))
  const relative = diffMinutes > 0 ? `in ${formatDuration(diffMinutes)}` : "now"
  return `resets ${relative} (${resetDate.toISOString()})`
}

function formatCredits(credits: CreditsSummary): string {
  if (credits.unlimited) return "unlimited plan"
  if (!credits.hasCredits) return "not included with this plan"
  if (credits.balance) return `balance ${credits.balance}`
  return "available"
}

function formatTokenUsage(usage: UsageRecordSummary["tokenUsage"]): string | undefined {
  if (!usage) return undefined
  const parts: string[] = []
  if (typeof usage.total === "number") parts.push(`total ${formatCompactNumber(usage.total)}`)
  if (typeof usage.input === "number") parts.push(`input ${formatCompactNumber(usage.input)}`)
  if (typeof usage.output === "number") parts.push(`output ${formatCompactNumber(usage.output)}`)
  if (typeof usage.cached === "number") parts.push(`cached ${formatCompactNumber(usage.cached)}`)
  if (typeof usage.cacheCreation === "number") parts.push(`cache writes ${formatCompactNumber(usage.cacheCreation)}`)
  if (parts.length === 0) return undefined
  return parts.join(" · ")
}

function formatCost(cost: CostSummary | undefined): string | undefined {
  if (!cost || typeof cost.totalCost !== "number") return undefined

  const parts: string[] = []
  parts.push(`total ${formatCurrency(cost.totalCost)}`)

  if (typeof cost.inputCost === "number" && cost.inputCost > 0) {
    parts.push(`input ${formatCurrency(cost.inputCost)}`)
  }
  if (typeof cost.outputCost === "number" && cost.outputCost > 0) {
    parts.push(`output ${formatCurrency(cost.outputCost)}`)
  }
  if (typeof cost.cacheReadCost === "number" && cost.cacheReadCost > 0) {
    parts.push(`cache read ${formatCurrency(cost.cacheReadCost)}`)
  }
  if (typeof cost.cacheCreationCost === "number" && cost.cacheCreationCost > 0) {
    parts.push(`cache write ${formatCurrency(cost.cacheCreationCost)}`)
  }

  if (parts.length === 0) return undefined
  return parts.join(" · ")
}

function formatCurrency(amount: number): string {
  if (amount === 0) return "$0.00"
  if (amount < 0.00001) return "<$0.00001"
  if (amount < 0.01) return `$${amount.toFixed(5)}`
  if (amount < 1) return `$${amount.toFixed(3)}`
  return `$${amount.toFixed(2)}`
}

function formatDuration(minutes: number): string {
  const clamped = Math.max(0, minutes)
  const hours = Math.floor(clamped / 60)
  const mins = Math.floor(clamped % 60)
  return `${hours}h ${mins}m`
}

function formatPercent(value: number): string {
  const rounded = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
  return rounded.replace(/\.0$/, "")
}

function formatCompactNumber(value: number): string {
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
