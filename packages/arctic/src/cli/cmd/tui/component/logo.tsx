import { Installation } from "@/installation"
import { Locale } from "@/util/locale"
import { TextAttributes, type RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { For, createMemo } from "solid-js"
import { useDirectory } from "../context/directory"
import { loadRecentSessions, type RecentSessionSummary } from "../../../recent-sessions"

type Theme = ReturnType<typeof useTheme>["theme"]
const MIN_CARD_WIDTH = 36

type Segment = {
  text: string
  color?: RGBA
  bold?: boolean
}

export function Logo() {
  const { theme } = useTheme()
  const directory = useDirectory()
  const dimensions = useTerminalDimensions()
  const recentSessions = createMemo(() => loadRecentSessions(3, directory()))
  const cardWidth = createMemo(() => {
    const available = Math.max(dimensions().width - 4, MIN_CARD_WIDTH * 2)
    return Math.max(MIN_CARD_WIDTH, Math.floor(available / 2))
  })
  const rows = createMemo(() => buildCard(theme, directory(), cardWidth(), recentSessions()))

  return (
    <box width={cardWidth()} alignItems="flex-start" justifyContent="flex-start">
      <box flexDirection="column" gap={0}>
        <For each={rows()}>
          {(row) => (
            <text wrapMode="none" selectable={false}>
              <For each={row}>
                {(segment) => (
                  <span
                    style={{
                      fg: segment.color ?? theme.text,
                      attributes: segment.bold ? TextAttributes.BOLD : undefined,
                    }}
                  >
                    {segment.text}
                  </span>
                )}
              </For>
            </text>
          )}
        </For>
      </box>
    </box>
  )
}

function buildCard(theme: Theme, directory: string, cardWidth: number, recents: RecentSessionSummary[]) {
  const rows: Segment[][] = []
  const borderColor = theme.info
  const contentWidth = Math.max(2, cardWidth - 4)
  const contentRows = buildContentRows(theme, directory, contentWidth, recents)

  rows.push(makeBorderRow("top", borderColor, Math.max(0, cardWidth - 2)))
  for (const row of contentRows) {
    rows.push(makeContentRow(padRow(row, contentWidth, theme.info), borderColor, theme))
  }
  rows.push(makeBorderRow("bottom", borderColor, Math.max(0, cardWidth - 2)))
  return rows
}

type ColumnLine = Segment | undefined

function buildContentRows(theme: Theme, directory: string, contentWidth: number, recents: RecentSessionSummary[]) {
  const minColumns = { left: 22, right: 20 }
  let leftWidth = Math.max(minColumns.left, Math.floor(contentWidth * 0.55))
  let rightWidth = contentWidth - leftWidth - 3
  if (rightWidth < minColumns.right) {
    rightWidth = minColumns.right
    leftWidth = Math.max(minColumns.left, contentWidth - rightWidth - 3)
  }
  const rows: Segment[][] = []
  const leftLines = buildLeftColumn(theme, directory, leftWidth)
  const rightLines = buildRightColumn(theme, rightWidth, recents)
  const totalRows = Math.max(leftLines.length, rightLines.length)
  for (let i = 0; i < totalRows; i++) {
    rows.push(buildTwoColumnRow(leftLines[i], rightLines[i], leftWidth, rightWidth, theme))
  }
  return rows
}

function buildLeftColumn(theme: Theme, directory: string, width: number): ColumnLine[] {
  const lines: ColumnLine[] = []
  lines.push({ text: "", color: theme.secondary })
  lines.push({ text: "Welcome back!", color: theme.primary, bold: true })
  lines.push({ text: "", color: theme.secondary })
  lines.push({ text: "", color: theme.secondary })
  lines.push({ text: `Arctic CLI v${Installation.VERSION}`, color: theme.secondary })
  lines.push({ text: `${Installation.CHANNEL} channel`, color: theme.info })
  lines.push({ text: "", color: theme.secondary })
  lines.push({ text: "Workspace", color: theme.primary, bold: true })
  for (const line of wrapPlainText(directory, width)) {
    lines.push({ text: line, color: theme.secondary })
  }
  return lines
}

function buildRightColumn(theme: Theme, width: number, recents: RecentSessionSummary[]): ColumnLine[] {
  const lines: ColumnLine[] = []
  lines.push({ text: "Tips for getting started", color: theme.primary, bold: true })
  const tips = ["Use `/init` to refresh AGENTS.md instructions.", "Run `/usage` to check current usage stats."]
  for (const tip of tips) {
    for (const line of bulletLines(tip, width)) {
      lines.push({ text: line, color: theme.info })
    }
  }
  lines.push({ text: "─".repeat(width), color: theme.info })
  lines.push({ text: "Recent activity", color: theme.primary, bold: true })
  if (recents.length === 0) {
    lines.push({ text: "No recent activity", color: theme.secondary })
  } else {
    for (const session of recents) {
      const title = Locale.truncate(session.title ?? session.id, width - 4)
      const timestamp = session.updated ? Locale.todayTimeOrDateTime(session.updated) : "unknown"
      const merged = `${title} · ${timestamp}`
      for (const line of bulletLines(merged, width)) {
        lines.push({ text: line, color: theme.secondary })
      }
    }
  }
  return lines
}

function makeBorderRow(position: "top" | "bottom", color: RGBA, innerWidth: number): Segment[] {
  const [start, end] = position === "top" ? ["╭", "╮"] : ["╰", "╯"]
  return [
    { text: start, color, bold: true },
    { text: "─".repeat(innerWidth), color, bold: true },
    { text: end, color, bold: true },
  ]
}

function makeContentRow(content: Segment[], borderColor: RGBA, theme: Theme): Segment[] {
  return [
    { text: "│", color: borderColor, bold: true },
    { text: " ", color: theme.info },
    ...content,
    { text: " ", color: theme.info },
    { text: "│", color: borderColor, bold: true },
  ]
}

function padRow(row: Segment[], width: number, defaultColor: RGBA) {
  const result: Segment[] = []
  let remaining = width
  for (const segment of row) {
    if (!segment.text) continue
    const len = segment.text.length
    if (len <= remaining) {
      result.push({ ...segment })
      remaining -= len
    } else if (remaining > 0) {
      result.push({ ...segment, text: segment.text.slice(0, remaining) })
      remaining = 0
      break
    } else {
      break
    }
  }
  if (remaining > 0) {
    result.push({ text: " ".repeat(remaining), color: defaultColor })
  }
  return result
}

function buildTwoColumnRow(
  left: ColumnLine,
  right: ColumnLine,
  leftWidth: number,
  rightWidth: number,
  theme: Theme,
): Segment[] {
  return [
    {
      text: padText(left?.text ?? "", leftWidth),
      color: left?.color ?? theme.secondary,
      bold: left?.bold,
    },
    { text: " │ ", color: theme.info },
    {
      text: padText(right?.text ?? "", rightWidth),
      color: right?.color ?? theme.secondary,
      bold: right?.bold,
    },
  ]
}

function padText(value: string, width: number) {
  const safeWidth = Math.max(0, width)
  if (value.length > safeWidth) return value.slice(0, safeWidth)
  return value.padEnd(safeWidth, " ")
}

function centerText(value: string, width: number) {
  const safeWidth = Math.max(0, width)
  if (!value || value.length >= safeWidth) return padText(value, safeWidth)
  const totalPadding = safeWidth - value.length
  const left = Math.floor(totalPadding / 2)
  const right = totalPadding - left
  return " ".repeat(left) + value + " ".repeat(right)
}

function bulletLines(text: string, columnWidth: number) {
  const bodyWidth = Math.max(1, columnWidth - 2)
  const wrapped = wrapPlainText(text, bodyWidth)
  return wrapped
    .map((line, index) => (index === 0 ? `• ${line}` : `  ${line}`))
    .map((line) => padText(line, columnWidth))
}

function wrapPlainText(value: string, width: number) {
  if (!value) return [""]
  const words = value.split(" ")
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    if (!word) continue
    if (word.length > width) {
      if (current) {
        lines.push(current)
        current = ""
      }
      let start = 0
      while (start < word.length) {
        lines.push(word.slice(start, start + width))
        start += width
      }
      continue
    }
    const attempt = current ? `${current} ${word}` : word
    if (attempt.length <= width) {
      current = attempt
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  if (!lines.length) lines.push("")
  return lines
}
