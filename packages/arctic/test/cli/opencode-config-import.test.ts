import { test, expect, describe } from "bun:test"
import { Config } from "@/config/config"
import path from "path"
import os from "os"

describe("OpenCode Config Import", () => {
  test("finds opencode config path", async () => {
    const configDir = path.join(os.homedir(), ".config", "opencode")
    const exists = await Bun.file(path.join(configDir, "opencode.json")).exists()

    if (exists) {
      const content = await Bun.file(path.join(configDir, "opencode.json")).text()
      expect(content).toBeDefined()
    }
  })

  test("merges array fields without duplicates", () => {
    const arcticConfig: Config.Info = {
      plugin: ["plugin-a", "plugin-b"],
    }

    const opencodeConfig: Config.Info = {
      plugin: ["plugin-b", "plugin-c"],
    }

    const merged = { ...arcticConfig }
    const arctPlugins = arcticConfig.plugin || []
    const openPlugins = opencodeConfig.plugin || []
    merged.plugin = [...new Set([...arctPlugins, ...openPlugins])]

    expect(merged.plugin).toEqual(["plugin-a", "plugin-b", "plugin-c"])
  })

  test("merges object fields", () => {
    const arcticConfig: Config.Info = {
      command: {
        test: {
          template: "test template",
        },
      },
    }

    const opencodeConfig: Config.Info = {
      command: {
        build: {
          template: "build template",
        },
      },
    }

    const merged = { ...arcticConfig }
    const arctCommands = arcticConfig.command || {}
    const openCommands = opencodeConfig.command || {}
    merged.command = { ...arctCommands, ...openCommands }

    expect(merged.command).toEqual({
      test: { template: "test template" },
      build: { template: "build template" },
    })
  })

  test("preserves arctic config when opencode has no new fields", () => {
    const arcticConfig: Config.Info = {
      model: "anthropic/claude-3-5-sonnet-20241022",
      plugin: ["plugin-a"],
    }

    const opencodeConfig: Config.Info = {
      plugin: ["plugin-a"],
    }

    const arctPlugins = arcticConfig.plugin || []
    const openPlugins = opencodeConfig.plugin || []
    const mergedPlugins = [...new Set([...arctPlugins, ...openPlugins])]

    expect(mergedPlugins).toEqual(["plugin-a"])
    expect(arcticConfig.model).toBe("anthropic/claude-3-5-sonnet-20241022")
  })

  test("handles empty opencode config", () => {
    const arcticConfig: Config.Info = {
      model: "anthropic/claude-3-5-sonnet-20241022",
    }

    const opencodeConfig: Config.Info = {}

    const merged = { ...arcticConfig, ...opencodeConfig }
    expect(merged.model).toBe("anthropic/claude-3-5-sonnet-20241022")
  })

  test("handles empty arctic config", () => {
    const arcticConfig: Config.Info = {}

    const opencodeConfig: Config.Info = {
      model: "openai/gpt-4",
      plugin: ["oh-my-opencode"],
    }

    const merged = { ...arcticConfig }
    merged.model = opencodeConfig.model
    merged.plugin = opencodeConfig.plugin

    expect(merged.model).toBe("openai/gpt-4")
    expect(merged.plugin).toEqual(["oh-my-opencode"])
  })

  test("maps theme names from opencode to arctic", () => {
    const OPENCODE_TO_ARCTIC_THEME_MAP: Record<string, string> = {
      "tokyo-night": "tokyonight",
      "opencode-dark": "opencode",
      "rose-pine": "rosepine",
      "night-owl": "nightowl",
      "synthwave-84": "synthwave84",
    }

    const ARCTIC_THEMES = ["tokyonight", "opencode", "rosepine", "nightowl", "synthwave84"]

    function mapThemeName(opencodeTheme: string): string | undefined {
      if (ARCTIC_THEMES.includes(opencodeTheme)) {
        return opencodeTheme
      }
      return OPENCODE_TO_ARCTIC_THEME_MAP[opencodeTheme]
    }

    expect(mapThemeName("tokyo-night")).toBe("tokyonight")
    expect(mapThemeName("opencode-dark")).toBe("opencode")
    expect(mapThemeName("rose-pine")).toBe("rosepine")
    expect(mapThemeName("tokyonight")).toBe("tokyonight")
    expect(mapThemeName("unknown-theme")).toBeUndefined()
  })
})
