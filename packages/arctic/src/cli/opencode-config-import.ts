import * as prompts from "@clack/prompts"
import { Storage } from "../storage/storage"
import { Config } from "../config/config"
import path from "path"
import os from "os"
import { Log } from "../util/log"

const log = Log.create({ service: "opencode-config-import" })

type OpenCodeConfigImportState = {
  asked: boolean
  decision: "yes" | "no"
  decidedAt: number
  importedFields: string[]
}

const STATE_KEY = ["cli", "opencode-config-import"]

async function readState() {
  return Storage.read<OpenCodeConfigImportState>(STATE_KEY).catch((err) => {
    if (err instanceof Storage.NotFoundError) return undefined
    throw err
  })
}

const OPENCODE_TO_ARCTIC_THEME_MAP: Record<string, string> = {
  "tokyo-night": "tokyonight",
  "opencode-dark": "opencode",
  "opencode-light": "opencode",
  "one-dark": "one-dark",
  "catppuccin-mocha": "catppuccin",
  "catppuccin-macchiato": "catppuccin-macchiato",
  "catppuccin-frappe": "catppuccin",
  "catppuccin-latte": "catppuccin",
  "rose-pine": "rosepine",
  "night-owl": "nightowl",
  "synthwave-84": "synthwave84",
}

const ARCTIC_THEMES = [
  "arctic",
  "aura",
  "ayu",
  "catppuccin",
  "catppuccin-macchiato",
  "claude",
  "cobalt2",
  "dracula",
  "everforest",
  "flexoki",
  "github",
  "gruvbox",
  "kanagawa",
  "material",
  "matrix",
  "mercury",
  "monokai",
  "nightowl",
  "nord",
  "one-dark",
  "opencode",
  "orng",
  "palenight",
  "rosepine",
  "solarized",
  "synthwave84",
  "tokyonight",
  "vercel",
  "vesper",
  "zenburn",
]

function mapThemeName(opencodeTheme: string): string | undefined {
  if (ARCTIC_THEMES.includes(opencodeTheme)) {
    return opencodeTheme
  }
  return OPENCODE_TO_ARCTIC_THEME_MAP[opencodeTheme]
}

async function getOpenCodeConfigPath(): Promise<string | undefined> {
  const configDir = path.join(os.homedir(), ".config", "opencode")
  const configFiles = ["opencode.json", "opencode.jsonc"]

  for (const file of configFiles) {
    const filepath = path.join(configDir, file)
    const exists = await Bun.file(filepath).exists()
    if (exists) {
      log.debug("found opencode config", { path: filepath })
      return filepath
    }
  }

  return undefined
}

async function readOpenCodeConfig(filepath: string): Promise<Config.Info | undefined> {
  const content = await Bun.file(filepath)
    .text()
    .catch(() => undefined)
  if (!content) return undefined

  const parsed = Config.Info.safeParse(JSON.parse(content))
  if (!parsed.success) {
    log.warn("failed to parse opencode config", { path: filepath, error: parsed.error })
    return undefined
  }

  return parsed.data
}

async function getCurrentArcticConfig(): Promise<Config.Info> {
  const Global = await import("../global").then((m) => m.Global)
  const configFiles = [
    path.join(Global.Path.config, "config.json"),
    path.join(Global.Path.config, "arctic.json"),
    path.join(Global.Path.config, "arctic.jsonc"),
  ]

  let result: Config.Info = {}
  for (const filepath of configFiles) {
    const content = await Bun.file(filepath)
      .text()
      .catch(() => undefined)
    if (content) {
      const parsed = Config.Info.safeParse(JSON.parse(content))
      if (parsed.success) {
        result = { ...result, ...parsed.data }
      }
    }
  }

  return result
}

const IMPORTABLE_CONFIG_FIELDS: (keyof Config.Info)[] = [
  "theme",
  "keybinds",
  "tui",
  "model",
  "small_model",
  "username",
  "command",
  "agent",
  "mode",
  "provider",
  "mcp",
  "formatter",
  "lsp",
  "instructions",
  "permission",
  "permission_profile",
  "tools",
  "plugin",
  "watcher",
  "snapshot",
  "autoupdate",
  "disabled_providers",
  "enabled_providers",
  "layout",
  "enterprise",
  "experimental",
]

function hasNewArrayContent(openArr: any[], arctArr: any[]): boolean {
  return openArr.length > 0 && openArr.some((item) => !arctArr.includes(item))
}

function hasNewObjectKeys(openObj: Record<string, any>, arctObj: Record<string, any>): boolean {
  return Object.keys(openObj).some((key) => !(key in arctObj))
}

function shouldImportField(opencodeConfig: Config.Info, arcticConfig: Config.Info, field: keyof Config.Info): boolean {
  const opencodeValue = opencodeConfig[field]
  const arcticValue = arcticConfig[field]

  if (!opencodeValue) return false

  if (Array.isArray(opencodeValue)) {
    const arctArr = (arcticValue as any[]) || []
    return hasNewArrayContent(opencodeValue, arctArr)
  }

  if (typeof opencodeValue === "object") {
    const arctObj = (arcticValue as Record<string, any>) || {}
    return hasNewObjectKeys(opencodeValue as Record<string, any>, arctObj)
  }

  return !arcticValue
}

function findImportableFields(opencodeConfig: Config.Info, arcticConfig: Config.Info): string[] {
  return IMPORTABLE_CONFIG_FIELDS.filter((field) => shouldImportField(opencodeConfig, arcticConfig, field))
}

function mergeArrayField(arctArr: any[], openArr: any[]): any[] {
  return [...new Set([...arctArr, ...openArr])]
}

function mergeObjectField(arctObj: Record<string, any>, openObj: Record<string, any>): Record<string, any> {
  return { ...arctObj, ...openObj }
}

function mergeConfigField(arcticValue: any, opencodeValue: any): any {
  if (Array.isArray(opencodeValue)) {
    const arctArr = (arcticValue as any[]) || []
    return mergeArrayField(arctArr, opencodeValue)
  }

  if (typeof opencodeValue === "object" && opencodeValue !== null) {
    const arctObj = (arcticValue as Record<string, any>) || {}
    return mergeObjectField(arctObj, opencodeValue as Record<string, any>)
  }

  return arcticValue || opencodeValue
}

function mergeConfigs(arcticConfig: Config.Info, opencodeConfig: Config.Info, fields: string[]): Config.Info {
  const merged = { ...arcticConfig }

  for (const field of fields) {
    const key = field as keyof Config.Info
    let value = opencodeConfig[key]

    if (key === "theme" && typeof value === "string") {
      const mappedTheme = mapThemeName(value)
      if (mappedTheme) {
        value = mappedTheme
        log.info("mapped theme", { from: opencodeConfig[key], to: mappedTheme })
      } else {
        log.warn("unknown theme, skipping", { theme: value })
        continue
      }
    }

    ;(merged as any)[key] = mergeConfigField(arcticConfig[key], value)
  }

  return merged
}

async function promptForImport(fields: string[]): Promise<boolean> {
  const fieldList = fields.join(", ")
  const confirm = await prompts.confirm({
    message: `Found OpenCode config with new settings (${fieldList}). Import these settings to Arctic?`,
    initialValue: true,
  })
  return !prompts.isCancel(confirm) && confirm
}

async function promptForDontAskAgain(): Promise<boolean> {
  const dontAskAgain = await prompts.confirm({
    message: "Don't ask again about importing OpenCode config?",
    initialValue: true,
  })
  return !prompts.isCancel(dontAskAgain) && dontAskAgain
}

async function saveImportDecision(decision: "yes" | "no", fields: string[]) {
  await Storage.write<OpenCodeConfigImportState>(STATE_KEY, {
    asked: true,
    decision,
    decidedAt: Date.now(),
    importedFields: fields,
  })
}

async function importConfig(arcticConfig: Config.Info, opencodeConfig: Config.Info, fields: string[]) {
  const merged = mergeConfigs(arcticConfig, opencodeConfig, fields)
  const Global = await import("../global").then((m) => m.Global)
  const configPath = path.join(Global.Path.config, "arctic.json")
  await Bun.write(configPath, JSON.stringify(merged, null, 2))
  log.info("imported opencode config", { fields })
}

export async function maybeImportOpenCodeConfig() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log.debug("not a tty, skipping opencode config import")
    return
  }
  if (process.env.CI) {
    log.debug("CI environment, skipping opencode config import")
    return
  }
  if (process.argv.some((arg) => ["-h", "--help", "-v", "--version"].includes(arg))) {
    log.debug("help/version flag, skipping opencode config import")
    return
  }

  const opencodeConfigPath = await getOpenCodeConfigPath()
  if (!opencodeConfigPath) {
    log.debug("no opencode config found")
    return
  }

  log.debug("found opencode config", { path: opencodeConfigPath })

  const opencodeConfig = await readOpenCodeConfig(opencodeConfigPath)
  if (!opencodeConfig) {
    log.debug("failed to read opencode config")
    return
  }

  log.debug("read opencode config successfully")

  const arcticConfig = await getCurrentArcticConfig()
  const importableFields = findImportableFields(opencodeConfig, arcticConfig)

  log.debug("found importable fields", { count: importableFields.length, fields: importableFields })

  if (importableFields.length === 0) {
    log.debug("no new fields to import from opencode config")
    return
  }

  const state = await readState()
  log.debug("import state", { asked: state?.asked, decision: state?.decision })

  if (state?.asked) {
    if (state.decision === "no") {
      log.debug("user previously declined import")
      return
    }
    if (state.decision === "yes") {
      log.debug("import already completed previously, skipping")
      return
    }
    return
  }

  log.info("prompting user to import opencode config")
  const shouldImport = await promptForImport(importableFields)

  const shouldSaveDecision = await promptForDontAskAgain()
  if (shouldSaveDecision) {
    log.info("saving import decision", { decision: shouldImport ? "yes" : "no" })
    await saveImportDecision(shouldImport ? "yes" : "no", importableFields)
  }

  if (!shouldImport) {
    log.info("user declined import")
    return
  }

  log.info("importing opencode config")
  await importConfig(arcticConfig, opencodeConfig, importableFields)
}
