import { Global } from "@/global"
import { Installation } from "@/installation"
import { Provider } from "@/provider/provider"
import { Session as SessionApi } from "@/session"
import { TextAttributes } from "@opentui/core"
import { render, useKeyboard, useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/solid"
import { DialogAgent } from "@tui/component/dialog-agent"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogMcp } from "@tui/component/dialog-mcp"
import { DialogModel, useConnected } from "@tui/component/dialog-model"
import { DialogProvider as DialogProviderList } from "@tui/component/dialog-provider"
import { DialogSessionList } from "@tui/component/dialog-session-list"
import { DialogStatus } from "@tui/component/dialog-status"
import { DialogThemeList } from "@tui/component/dialog-theme-list"
import { DialogUsage } from "@tui/component/dialog-usage"
import { KeybindProvider, useKeybind } from "@tui/context/keybind"
import { LocalProvider, useLocal } from "@tui/context/local"
import { RouteProvider, useRoute } from "@tui/context/route"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { Clipboard } from "@tui/util/clipboard"
import fs from "fs/promises"
import open from "open"
import path from "path"
import {
  ErrorBoundary,
  Match,
  Show,
  Switch,
  batch,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
} from "solid-js"
import { PromptHistoryProvider } from "./component/prompt/history"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import { ExitProvider, useExit } from "./context/exit"
import { KVProvider, useKV } from "./context/kv"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { TuiEvent } from "./event"
import { DialogAlert } from "./ui/dialog-alert"
import { DialogHelp } from "./ui/dialog-help"
import { ToastProvider, useToast } from "./ui/toast"

async function getTerminalBackgroundColor(): Promise<"dark" | "light"> {
  // can't set raw mode if not a TTY
  if (!process.stdin.isTTY) return "dark"

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout

    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.removeListener("data", handler)
      clearTimeout(timeout)
    }

    const handler = (data: Buffer) => {
      const str = data.toString()
      const match = str.match(/\x1b]11;([^\x07\x1b]+)/)
      if (match) {
        cleanup()
        const color = match[1]
        // Parse RGB values from color string
        // Formats: rgb:RR/GG/BB or #RRGGBB or rgb(R,G,B)
        let r = 0,
          g = 0,
          b = 0

        if (color.startsWith("rgb:")) {
          const parts = color.substring(4).split("/")
          r = parseInt(parts[0], 16) >> 8 // Convert 16-bit to 8-bit
          g = parseInt(parts[1], 16) >> 8 // Convert 16-bit to 8-bit
          b = parseInt(parts[2], 16) >> 8 // Convert 16-bit to 8-bit
        } else if (color.startsWith("#")) {
          r = parseInt(color.substring(1, 3), 16)
          g = parseInt(color.substring(3, 5), 16)
          b = parseInt(color.substring(5, 7), 16)
        } else if (color.startsWith("rgb(")) {
          const parts = color.substring(4, color.length - 1).split(",")
          r = parseInt(parts[0])
          g = parseInt(parts[1])
          b = parseInt(parts[2])
        }

        // Calculate luminance using relative luminance formula
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

        // Determine if dark or light based on luminance threshold
        resolve(luminance > 0.5 ? "light" : "dark")
      }
    }

    process.stdin.setRawMode(true)
    process.stdin.on("data", handler)
    process.stdout.write("\x1b]11;?\x07")

    timeout = setTimeout(() => {
      cleanup()
      resolve("dark")
    }, 1000)
  })
}

export function tui(input: { url: string; args: Args; onExit?: () => Promise<void> }) {
  // Enable Kitty keyboard protocol for better modifier key support
  process.stdout.write("\x1b[>1u")
  // Enable modifyOtherKeys (CSI u) for terminals that support it (e.g., Shift+Enter)
  process.stdout.write("\x1b[>4;2m")
  // Enable focus tracking to handle terminal tab switches
  process.stdout.write("\x1b[?1004h")

  // promise to prevent immediate exit
  return new Promise<void>(async (resolve) => {
    const mode = await getTerminalBackgroundColor()
    const onExit = async () => {
      // Restore terminal keyboard mode
      process.stdout.write("\x1b[<u")
      process.stdout.write("\x1b[>4;0m")
      // Disable focus tracking
      process.stdout.write("\x1b[?1004l")
      await input.onExit?.()
      resolve()
    }

    render(
      () => {
        return (
          <ErrorBoundary
            fallback={(error, reset) => <ErrorComponent error={error} reset={reset} onExit={onExit} mode={mode} />}
          >
            <ArgsProvider {...input.args}>
              <ExitProvider onExit={onExit}>
                <KVProvider>
                  <ToastProvider>
                    <RouteProvider>
                      <SDKProvider url={input.url}>
                        <SyncProvider>
                          <ThemeProvider mode={mode}>
                            <LocalProvider>
                              <KeybindProvider>
                                <DialogProvider>
                                  <PromptRefProvider>
                                    <CommandProvider>
                                      <PromptHistoryProvider>
                                        <App />
                                      </PromptHistoryProvider>
                                    </CommandProvider>
                                  </PromptRefProvider>
                                </DialogProvider>
                              </KeybindProvider>
                            </LocalProvider>
                          </ThemeProvider>
                        </SyncProvider>
                      </SDKProvider>
                    </RouteProvider>
                  </ToastProvider>
                </KVProvider>
              </ExitProvider>
            </ArgsProvider>
          </ErrorBoundary>
        )
      },
      {
        targetFps: 60,
        gatherStats: false,
        exitOnCtrlC: false,
        useKittyKeyboard: {},
        useMouse: true,
      },
    )
  })
}

function App() {
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  renderer.disableStdoutInterception()
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const command = useCommandDialog()
  const { event } = useSDK()
  const toast = useToast()
  const { theme, mode, setMode } = useTheme()
  const sync = useSync()
  const exit = useExit()
  const promptRef = usePromptRef()
  const keybind = useKeybind()

  const [showCopyButton, setShowCopyButton] = createSignal(false)
  const [copyButtonPos, setCopyButtonPos] = createSignal({ x: 0, y: 0 })
  let lastSelectionText = ""
  let lastMousePos = { x: 0, y: 0 }
  let lastCtrlCPress = 0

  onMount(() => {
    // Re-apply keyboard protocol modes after renderer setup.
    renderer.enableKittyKeyboard()
    process.stdout.write("\x1b[>4;1m")
    process.stdout.write("\x1b[>4;2m")

    // Handle terminal focus events (e.g., switching tabs)
    // Focus-in events trigger a repaint to fix rendering issues
    const handleStdinData = (data: Buffer) => {
      const str = data.toString()
      // Check for focus-in escape sequence (\x1b[I)
      if (str.includes("\x1b[I")) {
        renderer.currentRenderBuffer.clear()
        renderer.requestRender()
      }
    }

    process.stdin.on("data", handleStdinData)

    onCleanup(() => {
      process.stdin.off("data", handleStdinData)
    })
  })

  const debugKeyEvents = process.env["ARCTIC_KEY_DEBUG"] === "1"
  const debugKeyLogPath = path.join(Global.Path.log, "key-events.log")
  useKeyboard((event) => {
    if (!debugKeyEvents) return
    const payload = {
      time: new Date().toISOString(),
      name: event.name,
      ctrl: event.ctrl,
      shift: event.shift,
      meta: event.meta,
      option: event.option,
      super: event.super,
      sequence: event.sequence,
      raw: event.raw,
      code: event.code,
      source: event.source,
      eventType: event.eventType,
    }
    void fs.appendFile(debugKeyLogPath, JSON.stringify(payload) + "\n").catch(() => {})
  })

  useSelectionHandler((selection) => {
    const text = selection?.getSelectedText?.()
    lastSelectionText = text?.trim() ? text : ""

    if (lastSelectionText) {
      // Use the last mouse position to place the copy button
      setCopyButtonPos({ x: lastMousePos.x, y: lastMousePos.y })
      setShowCopyButton(true)
    } else {
      setShowCopyButton(false)
    }
  })
  useKeyboard((event) => {
    const name = event.name?.toLowerCase()

    // Clear selection state on Escape
    if (name === "escape") {
      lastSelectionText = ""
      setShowCopyButton(false)
      renderer.clearSelection()
      return
    }

    const isCopy = keybind.match("selection_copy", event)
    const isFallbackCopy = (event.ctrl && event.shift && name === "c") || (event.super && !event.ctrl && name === "c")
    const isCtrlC = event.ctrl && name === "c"

    if (isCopy || isFallbackCopy || isCtrlC) {
      // If the event was already handled (e.g., by prompt component), don't handle it here
      if (event.defaultPrevented) {
        return
      }

      // If the prompt has input, let the prompt component handle Ctrl+C
      if (promptRef.current?.current.input) {
        return
      }

      if (lastSelectionText) {
        // When text is selected, just copy it without tracking Ctrl+C presses for exit
        event.preventDefault?.()
        // Use OSC 52 escape sequence for clipboard (works in modern terminals without external tools)
        const base64 = Buffer.from(lastSelectionText).toString("base64")
        const osc52 = `\x1b]52;c;${base64}\x07`
        const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
        /* @ts-expect-error */
        renderer.writeOut(finalOsc52)
        // Also try native clipboard as fallback
        Clipboard.copy(lastSelectionText)
          .then(() => {
            toast.show({ message: "Selection copied to clipboard", variant: "success", duration: 1500 })
          })
          .catch(() => {
            toast.show({ message: "Failed to copy selection", variant: "error", duration: 3000 })
          })
        // Reset the double-press timer when copying selected text
        lastCtrlCPress = 0
      } else if (isCtrlC || isCopy) {
        // If nothing selected and it was a Ctrl+C (or equivalent exit bind), track for double-press exit
        const now = Date.now()
        if (now - lastCtrlCPress < 500) {
          // Second Ctrl+C within 500ms - exit
          exit()
          return
        }
        // First Ctrl+C - just record the time, don't exit
        lastCtrlCPress = now
      }
    }
  })

  // Update terminal window title based on current route and session
  createEffect(() => {
    if (route.data.type === "home") {
      renderer.setTerminalTitle("Arctic")
      return
    }

    if (route.data.type === "session") {
      const session = sync.session.get(route.data.sessionID)
      if (!session || SessionApi.isDefaultTitle(session.title)) {
        renderer.setTerminalTitle("Arctic")
        return
      }

      // Truncate title to 40 chars max
      const title = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
      renderer.setTerminalTitle(`OC | ${title}`)
    }
  })

  const args = useArgs()
  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        const { providerID, modelID } = Provider.parseModel(args.model)
        if (!providerID || !modelID)
          return toast.show({
            variant: "warning",
            message: `Invalid model format: ${args.model}`,
            duration: 3000,
          })
        local.model.set({ providerID, modelID }, { recent: true })
      }
      if (args.sessionID) {
        route.navigate({
          type: "session",
          sessionID: args.sessionID,
        })
      }
    })
  })

  let continued = false
  createEffect(() => {
    if (continued || sync.status !== "complete" || !args.continue) return
    const match = sync.data.session.find((x) => x.parentID === undefined)?.id
    if (match) {
      continued = true
      route.navigate({ type: "session", sessionID: match })
    }
  })

  createEffect(
    on(
      () => sync.status === "complete" && sync.data.provider.length === 0,
      (isEmpty, wasEmpty) => {
        // only trigger when we transition into an empty-provider state
        if (!isEmpty || wasEmpty) return
        dialog.replace(() => <DialogProviderList />)
      },
    ),
  )

  const connected = useConnected()
  command.register(() => [
    {
      title: "Switch session",
      value: "session.list",
      keybind: "session_list",
      category: "Session",
      suggested: sync.data.session.length > 0,
      onSelect: () => {
        dialog.replace(() => <DialogSessionList />)
      },
    },
    {
      title: "New session",
      suggested: route.data.type === "session",
      value: "session.new",
      keybind: "session_new",
      category: "Session",
      onSelect: () => {
        const current = promptRef.current
        // Don't require focus - if there's any text, preserve it
        const currentPrompt = current?.current?.input ? current.current : undefined
        route.navigate({
          type: "home",
          initialPrompt: currentPrompt,
        })
        dialog.clear()
      },
    },
    {
      title: "Switch model",
      value: "model.list",
      keybind: "model_list",
      suggested: true,
      category: "Agent",
      onSelect: () => {
        dialog.replace(() => <DialogModel />)
      },
    },
    {
      title: "Model cycle",
      disabled: true,
      value: "model.cycle_recent",
      keybind: "model_cycle_recent",
      category: "Agent",
      onSelect: () => {
        local.model.cycle(1)
      },
    },
    {
      title: "Model cycle reverse",
      disabled: true,
      value: "model.cycle_recent_reverse",
      keybind: "model_cycle_recent_reverse",
      category: "Agent",
      onSelect: () => {
        local.model.cycle(-1)
      },
    },
    {
      title: "Switch agent",
      value: "agent.list",
      keybind: "agent_list",
      category: "Agent",
      onSelect: () => {
        dialog.replace(() => <DialogAgent />)
      },
    },
    {
      title: "Toggle MCPs",
      value: "mcp.list",
      category: "Agent",
      onSelect: () => {
        dialog.replace(() => <DialogMcp />)
      },
    },
    {
      title: "Agent cycle",
      value: "agent.cycle",
      keybind: "agent_cycle",
      category: "Agent",
      disabled: true,
      onSelect: () => {
        local.agent.move(1)
      },
    },
    {
      title: "Agent cycle reverse",
      value: "agent.cycle.reverse",
      keybind: "agent_cycle_reverse",
      category: "Agent",
      disabled: true,
      onSelect: () => {
        local.agent.move(-1)
      },
    },
    {
      title: "Connect provider",
      value: "provider.connect",
      suggested: !connected(),
      onSelect: () => {
        dialog.replace(() => <DialogProviderList />)
      },
      category: "Provider",
    },
    {
      title: "View status",
      keybind: "status_view",
      value: "arctic.status",
      onSelect: () => {
        dialog.replace(() => <DialogStatus />)
      },
      category: "System",
    },
    {
      title: "View usage",
      value: "arctic.usage",
      onSelect: () => {
        dialog.replace(() => <DialogUsage />)
      },
      category: "System",
    },
    {
      title: "Switch theme",
      value: "theme.switch",
      onSelect: () => {
        dialog.replace(() => <DialogThemeList />)
      },
      category: "System",
    },
    {
      title: "Toggle appearance",
      value: "theme.switch_mode",
      onSelect: (dialog) => {
        setMode(mode() === "dark" ? "light" : "dark")
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Help",
      value: "help.show",
      onSelect: () => {
        dialog.replace(() => <DialogHelp />)
      },
      category: "System",
    },
    {
      title: "Open docs",
      value: "docs.open",
      onSelect: () => {
        open("https://arcticli.com/docs").catch(() => {})
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Exit the app",
      value: "app.exit",
      onSelect: () => exit(),
      category: "System",
    },
    {
      title: "Toggle debug panel",
      category: "System",
      value: "app.debug",
      onSelect: (dialog) => {
        renderer.toggleDebugOverlay()
        dialog.clear()
      },
    },
    {
      title: "Toggle console",
      category: "System",
      value: "app.fps",
      onSelect: (dialog) => {
        renderer.console.toggle()
        dialog.clear()
      },
    },
    {
      title: "Suspend terminal",
      value: "terminal.suspend",
      keybind: "terminal_suspend",
      category: "System",
      onSelect: () => {
        process.once("SIGCONT", () => {
          renderer.resume()
        })

        renderer.suspend()
        // pid=0 means send the signal to all processes in the process group
        process.kill(0, "SIGTSTP")
      },
    },
  ])

  createEffect(() => {
    const currentModel = local.model.current()
    if (!currentModel) return
    if (currentModel.providerID === "openrouter" && !kv.get("openrouter_warning", false)) {
      untrack(() => {
        DialogAlert.show(
          dialog,
          "Warning",
          "While openrouter is a convenient way to access LLMs your request will often be routed to subpar providers that do not work well in our testing.\n",
        ).then(() => kv.set("openrouter_warning", true))
      })
    }
  })

  event.on(TuiEvent.CommandExecute.type, (evt) => {
    command.trigger(evt.properties.command)
  })

  event.on(TuiEvent.ToastShow.type, (evt) => {
    toast.show({
      title: evt.properties.title,
      message: evt.properties.message,
      variant: evt.properties.variant,
      duration: evt.properties.duration,
    })
  })

  event.on(SessionApi.Event.Deleted.type, (evt) => {
    if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id) {
      dialog.clear()
      route.navigate({ type: "home" })
      toast.show({
        variant: "info",
        message: "The current session was deleted",
      })
    }
  })

  event.on(SessionApi.Event.Error.type, (evt) => {
    const error = evt.properties.error
    const message = (() => {
      if (!error) return "An error occured"

      if (typeof error === "object") {
        const data = error.data
        if ("message" in data && typeof data.message === "string") {
          return data.message
        }
      }
      return String(error)
    })()

    toast.show({
      variant: "error",
      message,
      duration: 5000,
    })
  })

  event.on(Installation.Event.Updated.type, (evt) => {
    toast.show({
      variant: "success",
      title: "Update Complete",
      message: `Arctic updated to v${evt.properties.version}`,
      duration: 5000,
    })
  })

  event.on(Installation.Event.UpdateAvailable.type, (evt) => {
    toast.show({
      variant: "info",
      title: "Update Available",
      message: `Arctic v${evt.properties.version} is available. Run 'arctic upgrade' to update manually.`,
      duration: 10000,
    })
  })

  const handleCopyClick = async () => {
    if (lastSelectionText) {
      // Use OSC 52 escape sequence for clipboard (works in modern terminals without external tools)
      const base64 = Buffer.from(lastSelectionText).toString("base64")
      const osc52 = `\x1b]52;c;${base64}\x07`
      const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
      /* @ts-expect-error */
      renderer.writeOut(finalOsc52)
      // Also try native clipboard as fallback
      await Clipboard.copy(lastSelectionText)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "success", duration: 1500 }))
        .catch(() => toast.show({ message: "Failed to copy", variant: "error", duration: 2000 }))
      renderer.clearSelection()
      setShowCopyButton(false)
    }
  }

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
      onMouseMove={(evt) => {
        lastMousePos = { x: evt.x, y: evt.y }
      }}
    >
      <Switch>
        <Match when={route.data.type === "home"}>
          <Home />
        </Match>
        <Match when={route.data.type === "session"}>
          <Session />
        </Match>
      </Switch>

      <Show when={showCopyButton()}>
        <box
          position="absolute"
          left={copyButtonPos().x + 2}
          top={copyButtonPos().y + 1}
          onMouseUp={handleCopyClick}
          backgroundColor={theme.primary}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.background} attributes={TextAttributes.BOLD}>
            Copy
          </text>
        </box>
      </Show>
    </box>
  )
}

function ErrorComponent(props: {
  error: Error
  reset: () => void
  onExit: () => Promise<void>
  mode?: "dark" | "light"
}) {
  const term = useTerminalDimensions()
  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") {
      props.onExit()
    }
  })
  const [copied, setCopied] = createSignal(false)

  const issueURL = new URL("https://github.com/arctic-cli/interface/issues/new?template=bug-report.yml")

  // Choose safe fallback colors per mode since theme context may not be available
  const isLight = props.mode === "light"
  const colors = {
    bg: isLight ? "#ffffff" : "#0a0a0a",
    text: isLight ? "#1a1a1a" : "#eeeeee",
    muted: isLight ? "#8a8a8a" : "#808080",
    primary: isLight ? "#3b7dd8" : "#fab283",
  }

  if (props.error.message) {
    issueURL.searchParams.set("title", `opentui: fatal: ${props.error.message}`)
  }

  if (props.error.stack) {
    issueURL.searchParams.set(
      "description",
      "```\n" + props.error.stack.substring(0, 6000 - issueURL.toString().length) + "...\n```",
    )
  }

  issueURL.searchParams.set("arctic-version", Installation.VERSION)

  const copyIssueURL = () => {
    Clipboard.copy(issueURL.toString()).then(() => {
      setCopied(true)
    })
  }

  return (
    <box flexDirection="column" gap={1} backgroundColor={colors.bg}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text attributes={TextAttributes.BOLD} fg={colors.text}>
          Please report an issue.
        </text>
        <box onMouseUp={copyIssueURL} backgroundColor={colors.primary} padding={1}>
          <text attributes={TextAttributes.BOLD} fg={colors.bg}>
            Copy issue URL (exception info pre-filled)
          </text>
        </box>
        {copied() && <text fg={colors.muted}>Successfully copied</text>}
      </box>
      <box flexDirection="row" gap={2} alignItems="center">
        <text fg={colors.text}>A fatal error occurred!</text>
        <box onMouseUp={props.reset} backgroundColor={colors.primary} padding={1}>
          <text fg={colors.bg}>Reset TUI</text>
        </box>
        <box onMouseUp={props.onExit} backgroundColor={colors.primary} padding={1}>
          <text fg={colors.bg}>Exit</text>
        </box>
      </box>
      <scrollbox height={Math.floor(term().height * 0.7)}>
        <text fg={colors.muted}>{props.error.stack}</text>
      </scrollbox>
      <text fg={colors.text}>{props.error.message}</text>
    </box>
  )
}
