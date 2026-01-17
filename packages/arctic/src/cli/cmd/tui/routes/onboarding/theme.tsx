import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import { useExit } from "@tui/context/exit"
import { useDialog } from "@tui/ui/dialog"
import { createSignal, For } from "solid-js"

const POPULAR_THEMES = [
  "arctic",
  "catppuccin",
  "catppuccin-macchiato",
  "github",
  "nord",
  "dracula",
  "tokyonight",
  "gruvbox",
  "solarized",
  "monokai",
  "one-dark",
  "aura",
  "ayu",
  "claude",
  "cobalt2",
  "everforest",
  "flexoki",
  "kanagawa",
  "material",
  "matrix",
  "mercury",
  "nightowl",
  "orng",
  "palenight",
  "rosepine",
  "synthwave84",
  "vercel",
  "vesper",
  "zenburn",
]

const SAMPLE_CODE = `function greet(name: string) {
  // Say hello to the user
  const message = \`Hello, \${name}!\`
  console.log(message)
  return message
}

const result = greet("Arctic")
`

export function OnboardingTheme() {
  const { theme, all, set: setTheme, selected } = useTheme()
  const route = useRoute()
  const kv = useKV()
  const exit = useExit()
  const dimensions = useTerminalDimensions()
  const dialog = useDialog()
  
  const allThemes = all()
  const themeNames = POPULAR_THEMES.filter((name) => allThemes[name])
  const [selectedIndex, setSelectedIndex] = createSignal(
    Math.max(0, themeNames.indexOf(selected))
  )

  const currentTheme = () => themeNames[selectedIndex()]

  useKeyboard((event) => {
    if (dialog.stack.length > 0) return
    
    if (event.name === "return" || event.name === "space") {
      setTheme(currentTheme())
      route.navigate({ type: "onboarding", step: "provider" })
    }
    if (event.name === "s" && !event.ctrl) {
      kv.set("onboarding_completed", true)
      route.navigate({ type: "home" })
    }
    if (event.name === "left" || event.name === "up") {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : themeNames.length - 1))
      setTheme(currentTheme())
    }
    if (event.name === "right" || event.name === "down") {
      setSelectedIndex((prev) => (prev < themeNames.length - 1 ? prev + 1 : 0))
      setTheme(currentTheme())
    }
    if (event.ctrl && event.name === "c") {
      exit()
    }
  })

  return (
    <scrollbox height={dimensions().height} width={dimensions().width}>
      <box flexDirection="column" alignItems="center" justifyContent="center" gap={2} minHeight={dimensions().height}>
      <box flexDirection="column" alignItems="center" gap={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Choose Your Theme
        </text>
        <text fg={theme.textMuted}>
          Step 2 of 5
        </text>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={1}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          {currentTheme()}
        </text>
        <text fg={theme.textMuted}>
          {selectedIndex() + 1} / {themeNames.length}
        </text>
      </box>

      <box
        flexDirection="column"
        width={Math.min(60, dimensions().width - 10)}
        backgroundColor={theme.backgroundElement}
        padding={2}
        gap={1}
      >
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Preview
        </text>
        <box flexDirection="column" gap={0}>
          <For each={SAMPLE_CODE.split("\n")}>
            {(line) => (
              <text fg={theme.text}>
                {line}
              </text>
            )}
          </For>
        </box>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={2}>
        <text fg={theme.textMuted}>
          Use arrow keys to browse themes
        </text>
        <box
          paddingLeft={3}
          paddingRight={3}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.primary}
        >
          <text fg={selectedForeground(theme)} attributes={TextAttributes.BOLD}>
            Press Enter to continue
          </text>
        </box>
        <text fg={theme.error}>
          or press 's' to skip onboarding
        </text>
      </box>
    </box>
    </scrollbox>
  )
}
