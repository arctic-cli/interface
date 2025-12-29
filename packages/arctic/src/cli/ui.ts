import z from "zod"
import { EOL } from "os"
import { NamedError } from "@arctic-cli/util/error"
import { Installation } from "../installation"
import { Locale } from "../util/locale"
import { loadRecentSessions } from "./recent-sessions"

export namespace UI {
  const RECENT_SESSION_LIMIT = 5
  const ANSI_REGEX = /\x1b\[[0-9;]*m/g
  const CONTENT_WIDTH = 70

  export const CancelledError = NamedError.create("UICancelledError", z.void())

  export const Style = {
    TEXT_HIGHLIGHT: "\x1b[96m",
    TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
    TEXT_DIM: "\x1b[90m",
    TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
    TEXT_NORMAL: "\x1b[0m",
    TEXT_NORMAL_BOLD: "\x1b[1m",
    TEXT_WARNING: "\x1b[93m",
    TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
    TEXT_DANGER: "\x1b[91m",
    TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
    TEXT_SUCCESS: "\x1b[92m",
    TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
    TEXT_INFO: "\x1b[94m",
    TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
  }

  export function println(...message: string[]) {
    print(...message)
    Bun.stderr.write(EOL)
  }

  export function print(...message: string[]) {
    blank = false
    Bun.stderr.write(message.join(" "))
  }

  let blank = false
  export function empty() {
    if (blank) return
    println("" + Style.TEXT_NORMAL)
    blank = true
  }

  export function logo(pad?: string) {
    const indent = pad ?? ""
    const lines = buildLines()
    return lines
      .map((line) => indent + padLine(line))
      .join(EOL)
      .trimEnd()
  }

  function buildLines() {
    const accent = Style.TEXT_INFO_BOLD
    const body = Style.TEXT_DIM
    const reset = Style.TEXT_NORMAL

    const rows: string[] = []
    rows.push(`${accent}Arctic ${reset} ${body}v${Installation.VERSION}${reset}`)
    rows.push(`${body}${ellipsize(process.cwd(), CONTENT_WIDTH)}${reset}`)
    rows.push(`${accent}Channel${reset} ${body}${Installation.CHANNEL}${reset}`)
    rows.push(`${accent}────────────────────────────────────────────${reset}`)
    rows.push(`${accent}Tips${reset}`)

    const tips = ["Run `arctic init` to create ARCTIC.md instructions.", "Start a new session with `arctic run`."]

    for (const tip of tips) {
      wrapText(tip, CONTENT_WIDTH - 2).forEach((line, index) => {
        const prefix = index === 0 ? "• " : "  "
        rows.push(`${body}${prefix}${line}${reset}`)
      })
    }

    rows.push("")
    rows.push(`${accent}Recent${reset}`)
    const recentSessions = loadRecentSessions(RECENT_SESSION_LIMIT)
    if (recentSessions.length === 0) {
      rows.push(`${body}No recent sessions${reset}`)
    } else {
      for (const session of recentSessions) {
        const title = Locale.truncate(session.title ?? session.id, 40)
        const timestamp = session.updated ? Locale.todayTimeOrDateTime(session.updated) : "unknown"
        const wrapped = wrapText(`${title} · ${timestamp}`, CONTENT_WIDTH - 4)
        wrapped.forEach((line, index) => {
          const prefix = index === 0 ? "• " : "  "
          rows.push(`${body}${prefix}${line}${reset}`)
        })
      }
    }
    rows.push(`${accent}────────────────────────────────────────────${reset}`)
    rows.push(`${accent}Prompt${reset}`)
    rows.push(`${body}> Ready for your next command${reset}`)
    return rows
  }

  function padLine(value: string) {
    const visible = stripAnsi(value)
    if (visible.length < CONTENT_WIDTH) return value + " ".repeat(CONTENT_WIDTH - visible.length)
    return value
  }

  function stripAnsi(value: string) {
    return value.replace(ANSI_REGEX, "")
  }

  function ellipsize(value: string, width: number) {
    if (value.length <= width) return value
    if (width <= 1) return value.slice(0, width)
    return value.slice(0, width - 1) + "…"
  }

  function wrapText(value: string, width: number) {
    if (!value) return [""]
    const words = value.split(" ")
    const lines: string[] = []
    let current = ""
    for (const word of words) {
      const attempt = current ? `${current} ${word}` : word
      if (stripAnsi(attempt).length <= width) {
        current = attempt
        continue
      }
      if (current) lines.push(current)
      current = word
    }
    if (current) lines.push(current)
    if (!lines.length) lines.push("")
    return lines
  }

  export async function input(prompt: string): Promise<string> {
    const readline = require("readline")
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(prompt, (answer: string) => {
        rl.close()
        resolve(answer.trim())
      })
    })
  }

  export function error(message: string) {
    println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
  }

  export function markdown(text: string): string {
    return text
  }
}
