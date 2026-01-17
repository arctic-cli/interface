import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import { useExit } from "@tui/context/exit"
import { useDialog } from "@tui/ui/dialog"
import { DialogProvider } from "@tui/component/dialog-provider"
import { useSync } from "@tui/context/sync"
import { createEffect, onCleanup } from "solid-js"

export function OnboardingProvider() {
  const { theme } = useTheme()
  const route = useRoute()
  const kv = useKV()
  const exit = useExit()
  const dialog = useDialog()
  const sync = useSync()
  const dimensions = useTerminalDimensions()

  let hasShownDialog = false

  createEffect(() => {
    if (sync.status === "complete" && !hasShownDialog) {
      hasShownDialog = true
      if (sync.data.provider.length === 0) {
        dialog.replace(() => <DialogProvider />)
      }
    }
  })

  useKeyboard((event) => {
    if (dialog.stack.length > 0) return
    if (event.defaultPrevented) return
    
    if (event.name === "return" || event.name === "space") {
      if (sync.data.provider.length > 0) {
        route.navigate({ type: "onboarding", step: "agents" })
      } else {
        dialog.replace(() => <DialogProvider />)
      }
    }
    if (event.name === "s" && !event.ctrl) {
      kv.set("onboarding_completed", true)
      route.navigate({ type: "home" })
    }
    if (event.name === "c" && !event.ctrl) {
      dialog.replace(() => <DialogProvider />)
    }
    if (event.ctrl && event.name === "c") {
      exit()
    }
  })

  onCleanup(() => {
    dialog.clear()
  })

  return (
    <scrollbox height={dimensions().height} width={dimensions().width}>
      <box flexDirection="column" alignItems="center" justifyContent="center" gap={2} minHeight={dimensions().height}>
      <box flexDirection="column" alignItems="center" gap={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Connect a Provider
        </text>
        <text fg={theme.textMuted}>
          Step 3 of 5
        </text>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={2} width={60}>
        <text fg={theme.text}>
          Arctic works with multiple AI providers.
        </text>
        <text fg={theme.text}>
          Connect at least one to get started.
        </text>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={2}>
        <text fg={theme.textMuted}>
          Popular providers:
        </text>
        <box flexDirection="column" gap={0} paddingLeft={2}>
          <text fg={theme.text}>
            • <span style={{ fg: theme.primary }}>Anthropic</span> - Claude models (Max or API key)
          </text>
          <text fg={theme.text}>
            • <span style={{ fg: theme.primary }}>OpenAI</span> - GPT models
          </text>
          <text fg={theme.text}>
            • <span style={{ fg: theme.primary }}>Google</span> - Gemini models
          </text>
          <text fg={theme.text}>
            • <span style={{ fg: theme.primary }}>GitHub Copilot</span> - Copilot models
          </text>
          <text fg={theme.text}>
            • <span style={{ fg: theme.primary }}>Ollama</span> - Local models
          </text>
        </box>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={3}>
        {sync.data.provider.length > 0 ? (
          <>
            <text fg={theme.success}>
              ✓ Connected to {sync.data.provider.length} provider{sync.data.provider.length > 1 ? "s" : ""}
            </text>
            <box flexDirection="row" gap={2}>
              <box
                paddingLeft={3}
                paddingRight={3}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.primary}
                onMouseUp={() => {
                  route.navigate({ type: "onboarding", step: "agents" })
                }}
              >
                <text fg={selectedForeground(theme)} attributes={TextAttributes.BOLD}>
                  Continue
                </text>
              </box>
              <box
                paddingLeft={3}
                paddingRight={3}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.backgroundElement}
                onMouseUp={() => {
                  dialog.replace(() => <DialogProvider />)
                }}
              >
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Add More
                </text>
              </box>
            </box>
            <text fg={theme.textMuted}>
              or press Enter to continue
            </text>
          </>
        ) : (
          <box
            paddingLeft={3}
            paddingRight={3}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={theme.primary}
            onMouseUp={() => {
              dialog.replace(() => <DialogProvider />)
            }}
          >
            <text fg={selectedForeground(theme)} attributes={TextAttributes.BOLD}>
              Connect Provider
            </text>
          </box>
        )}
        <text fg={theme.error}>
          or press 's' to skip onboarding
        </text>
      </box>
    </box>
    </scrollbox>
  )
}
