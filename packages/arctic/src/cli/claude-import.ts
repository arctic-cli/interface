import * as prompts from "@clack/prompts"
import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"

type ClaudeImportState = {
  asked: boolean
  decision: "yes" | "no"
  decidedAt: number
  importedAt?: number
  importedCount?: number
  sourceDir?: string
  targetDir?: string
}

const log = Log.create({ service: "cli.claude-import" })

const STATE_KEY = ["cli", "claude-import"]
const CLAUDE_COMMANDS_DIR = path.join(Global.Path.home, ".claude", "commands")
const TARGET_DIR = path.join(Global.Path.config, "command", "claude")

export async function maybeImportClaudeCommands() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return
  if (process.env.CI) return
  if (process.argv.some((arg) => ["-h", "--help", "-v", "--version"].includes(arg))) return

  const state = await readState()
  if (state?.asked) return

  const files = await listClaudeCommandFiles()
  if (files.length === 0) return

  const confirm = await prompts.confirm({
    message: "Import Claude commands from ~/.claude/commands into Arctic? (We won't ask again)",
    initialValue: true,
  })

  if (prompts.isCancel(confirm)) return

  if (!confirm) {
    await Storage.write<ClaudeImportState>(STATE_KEY, {
      asked: true,
      decision: "no",
      decidedAt: Date.now(),
      sourceDir: CLAUDE_COMMANDS_DIR,
      targetDir: TARGET_DIR,
    })
    return
  }

  const importedCount = await importClaudeCommands(files)

  await Storage.write<ClaudeImportState>(STATE_KEY, {
    asked: true,
    decision: "yes",
    decidedAt: Date.now(),
    importedAt: Date.now(),
    importedCount,
    sourceDir: CLAUDE_COMMANDS_DIR,
    targetDir: TARGET_DIR,
  })

  if (importedCount > 0) {
    prompts.log.success(`Imported ${importedCount} Claude command${importedCount === 1 ? "" : "s"} into Arctic`)
  } else {
    prompts.log.info("Claude commands already imported")
  }
}

async function readState() {
  return Storage.read<ClaudeImportState>(STATE_KEY).catch((err) => {
    if (err instanceof Storage.NotFoundError) return undefined
    throw err
  })
}

async function listClaudeCommandFiles(): Promise<string[]> {
  try {
    const stat = await fs.stat(CLAUDE_COMMANDS_DIR)
    if (!stat.isDirectory()) return []
  } catch {
    return []
  }

  const result: string[] = []
  const glob = new Bun.Glob("**/*.md")
  for await (const rel of glob.scan({ cwd: CLAUDE_COMMANDS_DIR, onlyFiles: true })) {
    result.push(path.join(CLAUDE_COMMANDS_DIR, rel))
  }
  return result
}

async function importClaudeCommands(files: string[]) {
  await fs.mkdir(TARGET_DIR, { recursive: true })
  let importedCount = 0

  for (const file of files) {
    const rel = path.relative(CLAUDE_COMMANDS_DIR, file)
    const dest = path.join(TARGET_DIR, rel)
    await fs.mkdir(path.dirname(dest), { recursive: true })

    const exists = await fs
      .stat(dest)
      .then(() => true)
      .catch(() => false)
    if (exists) continue

    await fs.copyFile(file, dest)
    importedCount += 1
  }

  log.info("claude commands import", { importedCount })
  return importedCount
}
