import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import { useExit } from "@tui/context/exit"
import { useLocal } from "@tui/context/local"
import { useDialog } from "@tui/ui/dialog"
import { createSignal, For } from "solid-js"

const AGENTS = [
  {
    name: "build",
    description: "General-purpose coding agent",
    details: "Best for writing code, fixing bugs, and implementing features",
    color: "#fab283",
  },
  {
    name: "plan",
    description: "Read-only planning agent",
    details: "Explores your codebase without making changes",
    color: "#8ab4f8",
  },
  {
    name: "explore",
    description: "Fast codebase exploration",
    details: "Quickly finds files and searches code patterns",
    color: "#81c995",
  },
  {
    name: "general",
    description: "Multi-step task execution",
    details: "Handles complex tasks requiring multiple steps",
    color: "#c58af9",
  },
]

export function OnboardingAgents() {
  const { theme } = useTheme()
  const route = useRoute()
  const kv = useKV()
  const exit = useExit()
  const local = useLocal()
  const dimensions = useTerminalDimensions()
  const dialog = useDialog()
  
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const currentAgent = () => AGENTS[selectedIndex()]

  useKeyboard((event) => {
    if (dialog.stack.length > 0) return
    
    if (event.name === "return" || event.name === "space") {
      route.navigate({ type: "onboarding", step: "commands" })
    }
    if (event.name === "escape" || event.name === "s") {
      kv.set("onboarding_completed", true)
      route.navigate({ type: "home" })
    }
    if (event.name === "tab") {
      const nextIndex = (selectedIndex() + 1) % AGENTS.length
      setSelectedIndex(nextIndex)
      local.agent.set(AGENTS[nextIndex].name)
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
          Meet Your AI Agents
        </text>
        <text fg={theme.textMuted}>
          Step 4 of 5
        </text>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={1}>
        <text fg={theme.text}>
          Arctic has 4 built-in agents, each specialized for different tasks
        </text>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          Press Tab to switch between agents
        </text>
      </box>

      <box
        flexDirection="column"
        width={70}
        backgroundColor={theme.backgroundElement}
        padding={2}
        gap={1}
        marginTop={2}
      >
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
          <text fg={currentAgent().color} attributes={TextAttributes.BOLD}>
            @{currentAgent().name}
          </text>
          <text fg={theme.textMuted}>
            {selectedIndex() + 1} / {AGENTS.length}
          </text>
        </box>
        
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {currentAgent().description}
        </text>
        
        <text fg={theme.textMuted}>
          {currentAgent().details}
        </text>

        <box flexDirection="column" gap={0} paddingTop={1}>
          <text fg={theme.textMuted}>
            All agents:
          </text>
          <box flexDirection="row" gap={2} paddingTop={1}>
            <For each={AGENTS}>
              {(agent, index) => (
                <text 
                  fg={index() === selectedIndex() ? agent.color : theme.textMuted}
                  attributes={index() === selectedIndex() ? TextAttributes.BOLD : 0}
                >
                  @{agent.name}
                </text>
              )}
            </For>
          </box>
        </box>
      </box>

      <box flexDirection="column" alignItems="center" gap={1} paddingTop={2}>
        <text fg={theme.textMuted}>
          You can switch agents anytime with Tab or /agent
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
