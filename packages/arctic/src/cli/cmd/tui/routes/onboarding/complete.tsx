import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import { useExit } from "@tui/context/exit"
import { useDialog } from "@tui/ui/dialog"

export function OnboardingComplete() {
  const { theme } = useTheme()
  const route = useRoute()
  const kv = useKV()
  const exit = useExit()
  const dimensions = useTerminalDimensions()
  const dialog = useDialog()

  useKeyboard((event) => {
    if (dialog.stack.length > 0) return
    
    if (event.name === "return" || event.name === "space") {
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
        <text fg={theme.success} attributes={TextAttributes.BOLD}>
          You're All Set!
        </text>
        <text fg={theme.textMuted}>
          Arctic is ready to help you code
        </text>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={2} width={60}>
        <text fg={theme.text}>
          Start by typing your first prompt or command.
        </text>
        <text fg={theme.text}>
          Arctic will assist you with coding tasks, answer questions,
        </text>
        <text fg={theme.text}>
          and help you navigate your codebase.
        </text>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={2}>
        <text fg={theme.textMuted}>
          Quick tips:
        </text>
        <box flexDirection="column" gap={0} paddingLeft={2}>
          <text fg={theme.text}>
            • Use <span style={{ fg: theme.primary }}>Tab</span> to switch agents
          </text>
          <text fg={theme.text}>
            • Type <span style={{ fg: theme.primary }}>/help</span> to see all commands
          </text>
          <text fg={theme.text}>
            • Press <span style={{ fg: theme.primary }}>Ctrl+X M</span> to change models
          </text>
          <text fg={theme.text}>
            • Visit <span style={{ fg: theme.primary }}>usearctic.sh/docs</span> for documentation
          </text>
        </box>
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
            Press Enter to start coding
          </text>
        </box>
      </box>
    </box>
    </scrollbox>
  )
}
