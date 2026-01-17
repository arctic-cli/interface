import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import { useExit } from "@tui/context/exit"
import { useDialog } from "@tui/ui/dialog"

export function OnboardingWelcome() {
  const { theme } = useTheme()
  const route = useRoute()
  const kv = useKV()
  const exit = useExit()
  const dimensions = useTerminalDimensions()
  const dialog = useDialog()

  useKeyboard((event) => {
    if (dialog.stack.length > 0) return
    
    if (event.name === "return" || event.name === "space") {
      route.navigate({ type: "onboarding", step: "theme" })
    }
    if (event.name === "s" && !event.ctrl) {
      kv.set("onboarding_completed", true)
      route.navigate({ type: "home" })
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
          Welcome to Arctic
        </text>
        <text fg={theme.textMuted}>
          Your AI-powered coding assistant
        </text>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={2}>
        <text fg={theme.text}>
          Let's get you set up in just a few steps
        </text>
        <text fg={theme.textMuted}>
          Step 1 of 5
        </text>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={3}>
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
