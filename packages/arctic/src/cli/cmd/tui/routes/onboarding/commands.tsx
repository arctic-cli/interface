import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import { useExit } from "@tui/context/exit"
import { useDialog } from "@tui/ui/dialog"
import { For } from "solid-js"

const COMMANDS = [
  {
    command: "/connect",
    description: "Connect or manage AI providers",
  },
  {
    command: "/models",
    description: "Switch between different AI models",
  },
  {
    command: "/agent",
    description: "Switch between agents",
  },
  {
    command: "/usage",
    description: "View your API usage statistics",
  },
  {
    command: "/status",
    description: "Check system status (MCP, LSP, permissions)",
  },
  {
    command: "/theme",
    description: "Change your theme",
  },
  {
    command: "/help",
    description: "View all available commands",
  },
]

const SHORTCUTS = [
  {
    key: "Tab",
    description: "Switch between agents",
  },
  {
    key: "Ctrl+X M",
    description: "Open model selector",
  },
  {
    key: "Ctrl+X S",
    description: "View status",
  },
  {
    key: "Ctrl+X L",
    description: "List sessions",
  },
  {
    key: "Ctrl+X N",
    description: "New session",
  },
]

export function OnboardingCommands() {
  const { theme } = useTheme()
  const route = useRoute()
  const kv = useKV()
  const exit = useExit()
  const dimensions = useTerminalDimensions()
  const dialog = useDialog()

  useKeyboard((event) => {
    if (dialog.stack.length > 0) return
    
    if (event.name === "return" || event.name === "space") {
      route.navigate({ type: "onboarding", step: "complete" })
    }
    if (event.name === "escape" || event.name === "s") {
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
          Useful Commands
        </text>
        <text fg={theme.textMuted}>
          Step 5 of 5
        </text>
      </box>

      <box flexDirection="row" gap={4} paddingTop={2}>
        <box flexDirection="column" gap={1} width={40}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            Commands
          </text>
          <box flexDirection="column" gap={0}>
            <For each={COMMANDS}>
              {(cmd) => (
                <box flexDirection="row" gap={1}>
                  <text fg={theme.accent} attributes={TextAttributes.BOLD} width={10}>
                    {cmd.command}
                  </text>
                  <text fg={theme.textMuted}>
                    {cmd.description}
                  </text>
                </box>
              )}
            </For>
          </box>
        </box>

        <box flexDirection="column" gap={1} width={35}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            Keyboard Shortcuts
          </text>
          <box flexDirection="column" gap={0}>
            <For each={SHORTCUTS}>
              {(shortcut) => (
                <box flexDirection="row" gap={1}>
                  <text fg={theme.accent} attributes={TextAttributes.BOLD} width={10}>
                    {shortcut.key}
                  </text>
                  <text fg={theme.textMuted}>
                    {shortcut.description}
                  </text>
                </box>
              )}
            </For>
          </box>
        </box>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={3}>
        <text fg={theme.textMuted}>
          Type /help anytime to see all available commands
        </text>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={2}>
        <box
          paddingLeft={3}
          paddingRight={3}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.primary}
        >
          <text fg={theme.background} attributes={TextAttributes.BOLD}>
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
