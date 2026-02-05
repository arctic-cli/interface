import { Identifier } from "@/id/id"
import { Ide } from "@/ide"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { BashTool } from "@/tool/bash"
import type { EditTool } from "@/tool/edit"
import type { GlobTool } from "@/tool/glob"
import type { GrepTool } from "@/tool/grep"
import type { ListTool } from "@/tool/ls"
import type { PatchTool } from "@/tool/patch"
import type { ReadTool } from "@/tool/read"
import type { TaskTool } from "@/tool/task"
import { TodoWriteTool } from "@/tool/todo"
import type { Tool } from "@/tool/tool"
import type { WebFetchTool } from "@/tool/webfetch"
import type { WriteTool } from "@/tool/write"
import { iife } from "@/util/iife"
import { Locale } from "@/util/locale"
import type { AssistantMessage, Part, ReasoningPart, TextPart, ToolPart, UserMessage } from "@arctic-cli/sdk/v2"
import {
  addDefaultParsers,
  BoxRenderable,
  MacOSScrollAccel,
  RGBA,
  ScrollBoxRenderable,
  TextAttributes,
  type ScrollAcceleration,
} from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions, type BoxProps, type JSX } from "@opentui/solid"
import { SplitBorder } from "@tui/component/border"
import { useCommandDialog } from "@tui/component/dialog-command"
import { Markdown } from "@tui/component/markdown"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import { useExitConfirmation } from "@tui/context/exit-confirmation"
import { useKeybind } from "@tui/context/keybind"
import { useLocal } from "@tui/context/local"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createShimmerColors, createShimmerFrames, getRandomWord } from "@tui/ui/shimmer-text"
import { parsePatch } from "diff"
import "opentui-spinner/solid"
import path from "path"
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  useContext,
  type Component,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import stripAnsi from "strip-ansi"
import parsers from "../../../../../../parsers-config.ts"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import type { PromptInfo } from "../../component/prompt/history"
import { useKV } from "../../context/kv.tsx"
import { usePromptRef } from "../../context/prompt"
import { useDialog } from "../../ui/dialog"
import { Toast, useToast } from "../../ui/toast"
import { Clipboard } from "../../util/clipboard"
import { Editor } from "../../util/editor"
import { DialogMessage } from "./dialog-message"
import { DialogTimeline } from "./dialog-timeline"
import { Footer } from "./footer.tsx"
import { Sidebar } from "./sidebar"

addDefaultParsers(parsers.parsers)

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

const context = createContext<{
  width: number
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  usernameVisible: () => boolean
  showDetails: () => boolean
  userMessageMarkdown: () => boolean
  diffWrapMode: () => "word" | "none"
  interruptCount: () => number
  sync: ReturnType<typeof useSync>
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}

export function Session() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  const exitConfirmation = useExitConfirmation()
  const [interruptCount, setInterruptCount] = createSignal(0)
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const permissions = createMemo(() => sync.data.permission[route.sessionID] ?? [])
  const benchmarkParent = createMemo(() => {
    const current = session()
    if (current?.benchmark?.type === "parent") return current
    if (current?.benchmark?.type === "child") {
      return sync.session.get(current.benchmark.parentID)
    }
    return undefined
  })
  const benchmarkChildren = createMemo(() => {
    const parent = benchmarkParent()
    if (parent?.benchmark?.type !== "parent") return []
    return parent.benchmark.children
  })
  const benchmarkEnabled = createMemo(() => {
    const parent = benchmarkParent()
    return parent?.benchmark?.type === "parent" && parent.benchmark.enabled
  })
  const benchmarkModelOptions = createMemo(() => {
    return sync.data.provider.flatMap((provider) => {
      return Object.entries(provider.models ?? {}).flatMap(([modelID, info]) => {
        if (info.status === "deprecated") return []
        const value = { providerID: provider.id, modelID }
        return [
          {
            value,
            title: info.name ?? modelID,
            description: provider.name,
            category: provider.name,
            disabled: provider.id === "arctic" && modelID.includes("-nano"),
            footer: info.cost?.input === 0 && provider.id === "arctic" ? "Free" : undefined,
          },
        ]
      })
    })
  })

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  const dimensions = useTerminalDimensions()
  const [conceal, setConceal] = createSignal(true)
  const [showThinking, setShowThinking] = createSignal(kv.get("thinking_visibility", true))
  const [showTimestamps, setShowTimestamps] = createSignal(kv.get("timestamps", "hide") === "show")
  const [usernameVisible, setUsernameVisible] = createSignal(kv.get("username_visible", true))
  const [showDetails, setShowDetails] = createSignal(kv.get("tool_details_visibility", true))
  const [showScrollbar, setShowScrollbar] = createSignal(kv.get("scrollbar_visible", true))
  const [showSidebar, setShowSidebar] = createSignal(kv.get("sidebar_visible", false))

  const [canScroll, setCanScroll] = createSignal(true)

  // check overflow only when messages or dimensions change, not on interval
  createEffect(() => {
    if (!scroll) return
    // trigger on messages or dimensions change
    messages()
    dimensions()
    const contentHeight = scroll.scrollHeight
    const viewportHeight = scroll.height
    setCanScroll(contentHeight > viewportHeight)
  })
  const [userMessageMarkdown, setUserMessageMarkdown] = createSignal(kv.get("user_message_markdown", true))
  const [diffWrapMode, setDiffWrapMode] = createSignal<"word" | "none">("word")

  const contentWidth = createMemo(() => Math.max(0, dimensions().width - 4 - (showSidebar() ? 42 : 0)))

  const scrollAcceleration = createMemo(() => {
    const tui = sync.data.config.tui
    if (tui?.scroll_acceleration?.enabled) {
      return new MacOSScrollAccel()
    }
    if (tui?.scroll_speed) {
      return new CustomSpeedScroll(tui.scroll_speed)
    }

    return new CustomSpeedScroll(3)
  })

  createEffect(async () => {
    await sync.session
      .sync(route.sessionID)
      .then(() => {
        if (scroll) scroll.scrollBy(100_000)
      })
      .catch((e) => {
        console.error(e)
        toast.show({
          message: `Session not found: ${route.sessionID}`,
          variant: "error",
        })
        return navigate({ type: "home" })
      })
  })

  const toast = useToast()
  const sdk = useSDK()

  // Auto-navigate to whichever session currently needs permission input
  createEffect(() => {
    const currentSession = session()
    if (!currentSession) return
    const currentPermissions = permissions()
    let targetID = currentPermissions.length > 0 ? currentSession.id : undefined

    if (!targetID) {
      const child = sync.data.session.find(
        (x) => x.parentID === currentSession.id && (sync.data.permission[x.id]?.length ?? 0) > 0,
      )
      if (child) targetID = child.id
    }

    if (targetID && targetID !== currentSession.id) {
      navigate({
        type: "session",
        sessionID: targetID,
      })
    }
  })

  let scroll: ScrollBoxRenderable
  let prompt: PromptRef
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    const first = permissions()[0]
    if (first) {
      const response = iife(() => {
        if (evt.ctrl || evt.meta) return
        if (evt.name === "return") return "once"
        if (evt.name === "a") return "always"
        if (evt.name === "d") return "reject"
        if (evt.name === "escape") return "reject"
        return
      })
      if (response) {
        sdk.client.permission.respond({
          permissionID: first.id,
          sessionID: route.sessionID,
          response: response,
        })
      }
    }
  })

  function toBottom() {
    setTimeout(() => {
      if (scroll) scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const local = useLocal()

  function moveChild(direction: number) {
    const parentID = session()?.parentID ?? session()?.id
    let children = sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((b, a) => a.id.localeCompare(b.id))
    if (children.length === 1) return
    let next = children.findIndex((x) => x.id === session()?.id) + direction
    if (next >= children.length) next = 0
    if (next < 0) next = children.length - 1
    if (children[next]) {
      navigate({
        type: "session",
        sessionID: children[next].id,
      })
    }
  }

  function moveBenchmark(direction: number) {
    if (!benchmarkEnabled()) return
    const children = benchmarkChildren()
    if (children.length <= 1) return
    const currentID = session().id
    let index = children.findIndex((child) => child.sessionID === currentID)
    if (index === -1) {
      index = direction > 0 ? 0 : children.length - 1
    } else {
      index = (index + direction + children.length) % children.length
    }
    const target = children[index]
    if (target) {
      navigate({
        type: "session",
        sessionID: target.sessionID,
      })
    }
  }

  async function startBenchmark(dialog: ReturnType<typeof useDialog>) {
    // Ensure dialog is clear before starting
    if (dialog.stack.length > 0) {
      dialog.clear()
    }
    if (benchmarkEnabled()) {
      toast.show({
        variant: "warning",
        message: "Benchmark mode is already enabled for this session.",
        duration: 3000,
      })
      return
    }
    const countInput = await DialogPrompt.show(dialog, "Benchmark session count", {
      placeholder: "2",
      value: "2",
    })
    if (!countInput) {
      setTimeout(() => promptRef.current?.focus(), 1)
      return
    }
    const count = Math.max(1, parseInt(countInput, 10))
    if (!Number.isFinite(count) || count <= 0) {
      toast.show({
        variant: "error",
        message: "Enter a valid number of sessions.",
        duration: 3000,
      })
      return
    }
    const models = []
    const prompts: string[] = []
    for (let i = 0; i < count; i++) {
      const model = await selectBenchmarkModel(dialog, i + 1)
      if (!model) {
        setTimeout(() => promptRef.current?.focus(), 1)
        return
      }
      models.push(model)
      const prompt = await DialogPrompt.show(dialog, `Prompt for slot ${i + 1}`, {
        placeholder: "Leave empty to skip",
      })
      if (prompt === null) {
        setTimeout(() => promptRef.current?.focus(), 1)
        return
      }
      prompts.push(prompt)
    }
    const duplicates = new Set(models.map((m) => `${m.providerID}/${m.modelID}`)).size !== models.length
    let allowDuplicates = false
    if (duplicates) {
      const confirmed = await DialogConfirm.show(
        dialog,
        "Duplicate models detected",
        "Some models are repeated across slots. Continue?",
      )
      if (!confirmed) {
        setTimeout(() => promptRef.current?.focus(), 1)
        return
      }
      allowDuplicates = true
    }
    const result = await sdk.client.session.benchmark.start({
      sessionID: route.sessionID,
      models,
      allowDuplicates,
    })
    if (result.error) {
      toast.show({
        variant: "error",
        message: "Failed to start benchmark mode.",
        duration: 3000,
      })
      return
    }
    const parent = result.data
    const firstChild = parent?.benchmark?.type === "parent" ? parent.benchmark.children[0] : undefined
    if (firstChild) {
      navigate({
        type: "session",
        sessionID: firstChild.sessionID,
      })
      setTimeout(() => {
        promptRef.current?.focus()
      }, 1)
    }
    if (parent?.benchmark?.type === "parent") {
      const promptQueue = new Map<string, string[]>()
      for (let i = 0; i < models.length; i++) {
        const key = `${models[i].providerID}/${models[i].modelID}`
        const prompt = prompts[i]
        if (!promptQueue.has(key)) promptQueue.set(key, [])
        promptQueue.get(key)!.push(prompt)
      }
      await Promise.all(
        parent.benchmark.children.map((child) => {
          const key = `${child.model.providerID}/${child.model.modelID}`
          const prompt = promptQueue.get(key)?.shift()?.trim()
          if (!prompt) return Promise.resolve()
          return sdk.client.session.prompt({
            sessionID: child.sessionID,
            messageID: Identifier.ascending("message"),
            agent: local.agent.current().name,
            model: child.model,
            parts: [
              {
                id: Identifier.ascending("part"),
                type: "text",
                text: prompt,
              },
            ],
          })
        }),
      )
    }
  }

  async function selectBenchmarkModel(
    dialog: ReturnType<typeof useDialog>,
    slot: number,
  ): Promise<{ providerID: string; modelID: string } | null> {
    return new Promise((resolve) => {
      let settled = false
      dialog.replace(
        () => (
          <DialogSelect
            title={`Select model (slot ${slot})`}
            options={benchmarkModelOptions()}
            current={local.model.current()}
            onSelect={(option) => {
              settled = true
              resolve(option.value)
              dialog.clear()
            }}
          />
        ),
        () => {
          if (!settled) resolve(null)
        },
      )
    })
  }

  async function stopBenchmark() {
    const parent = benchmarkParent()
    if (!parent) {
      toast.show({
        variant: "warning",
        message: "Benchmark mode is not enabled for this session.",
        duration: 3000,
      })
      return
    }
    await sdk.client.session.benchmark.stop({
      sessionID: parent.id,
    })
  }

  async function applyBenchmark(dialog: ReturnType<typeof useDialog>) {
    if (session().benchmark?.type !== "child") {
      toast.show({
        variant: "warning",
        message: "Switch to a benchmark child session to apply changes.",
        duration: 3000,
      })
      return
    }
    const benchmark = session().benchmark
    if (benchmark?.type === "child" && benchmark.error) {
      toast.show({
        variant: "error",
        message: `Benchmark session error: ${benchmark.error}`,
        duration: 5000,
      })
      return
    }
    const parent = benchmarkParent()
    if (parent?.benchmark?.type !== "parent") return
    const applied = parent.benchmark.appliedSessionID
    if (applied && applied !== session().id) {
      const confirmed = await DialogConfirm.show(
        dialog,
        "Another benchmark session is applied",
        "Undo it and apply this session?",
      )
      if (!confirmed) return
      const undoResult = await sdk.client.session.benchmark.undo({ sessionID: parent.id })
      if (
        undoResult.error &&
        "name" in undoResult.error &&
        (undoResult.error as any).name === "BenchmarkWorkingTreeDirtyError"
      ) {
        const dirtyConfirmed = await DialogConfirm.show(dialog, "Working tree is dirty", "Apply anyway?")
        if (!dirtyConfirmed) return
        await sdk.client.session.benchmark.undo({ sessionID: parent.id, allowDirty: true })
      }
    }
    const result = await sdk.client.session.benchmark.apply({ sessionID: session().id })
    if (result.error && "name" in result.error && (result.error as any).name === "BenchmarkWorkingTreeDirtyError") {
      const confirmed = await DialogConfirm.show(dialog, "Working tree is dirty", "Apply anyway?")
      if (!confirmed) return
      await sdk.client.session.benchmark.apply({ sessionID: session().id, allowDirty: true })
      return
    }
    if (result.error && "name" in result.error && (result.error as any).name === "BenchmarkSnapshotUnavailableError") {
      toast.show({
        variant: "error",
        message: "No snapshot available for this benchmark session.",
        duration: 3000,
      })
      return
    }
    if (result.error) {
      toast.show({
        variant: "error",
        message: "Failed to apply benchmark changes.",
        duration: 3000,
      })
    }
  }

  async function undoBenchmark(dialog: ReturnType<typeof useDialog>) {
    const parent = benchmarkParent()
    if (!parent) return
    const result = await sdk.client.session.benchmark.undo({ sessionID: parent.id })
    if (result.error && "name" in result.error && (result.error as any).name === "BenchmarkWorkingTreeDirtyError") {
      const confirmed = await DialogConfirm.show(dialog, "Working tree is dirty", "Undo anyway?")
      if (!confirmed) return
      await sdk.client.session.benchmark.undo({ sessionID: parent.id, allowDirty: true })
      return
    }
    if (result.error) {
      toast.show({
        variant: "error",
        message: "Failed to undo benchmark changes.",
        duration: 3000,
      })
    }
  }

  const command = useCommandDialog()
  command.register(() => [
    {
      title: "Rename session",
      value: "session.rename",
      keybind: "session_rename",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
      },
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      keybind: "session_timeline",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
            setPrompt={(promptInfo) => prompt.set(promptInfo)}
          />
        ))
      },
    },
    {
      title: "Compact session",
      value: "session.compact",
      keybind: "session_compact",
      category: "Session",
      onSelect: (dialog) => {
        const selectedModel = local.model.current()
        if (!selectedModel) {
          toast.show({
            variant: "warning",
            message: "Connect a provider to summarize this session",
            duration: 3000,
          })
          return
        }
        sdk.client.session.summarize({
          sessionID: route.sessionID,
          modelID: selectedModel.modelID,
          providerID: selectedModel.providerID,
        })
        dialog.clear()
      },
    },
    {
      title: "Start benchmark mode",
      value: "benchmark.start",
      category: "Benchmark",
      onSelect: (dialog) => {
        startBenchmark(dialog)
      },
    },
    {
      title: "Stop benchmark mode",
      value: "benchmark.stop",
      category: "Benchmark",
      disabled: !benchmarkEnabled(),
      onSelect: (dialog) => {
        stopBenchmark()
        dialog.clear()
      },
    },
    {
      title: "Benchmark next session",
      value: "benchmark.next",
      keybind: "benchmark_next",
      category: "Benchmark",
      disabled: !benchmarkEnabled(),
      onSelect: (dialog) => {
        moveBenchmark(1)
        dialog.clear()
      },
    },
    {
      title: "Benchmark previous session",
      value: "benchmark.prev",
      keybind: "benchmark_prev",
      category: "Benchmark",
      disabled: !benchmarkEnabled(),
      onSelect: (dialog) => {
        moveBenchmark(-1)
        dialog.clear()
      },
    },
    {
      title: "Apply benchmark changes",
      value: "benchmark.apply",
      keybind: "benchmark_apply",
      category: "Benchmark",
      disabled: !benchmarkEnabled() || session()?.benchmark?.type !== "child",
      onSelect: (dialog) => {
        applyBenchmark(dialog)
      },
    },
    {
      title: "Undo benchmark changes",
      value: "benchmark.undo",
      keybind: "benchmark_undo",
      category: "Benchmark",
      disabled: !benchmarkEnabled(),
      onSelect: (dialog) => {
        undoBenchmark(dialog)
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      keybind: "messages_undo",
      category: "Session",
      onSelect: async (dialog) => {
        const status = sync.data.session_status[route.sessionID]
        if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => {})
        const revert = session().revert?.messageID
        const message = messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        sdk.client.session
          .revert({
            sessionID: route.sessionID,
            messageID: message.id,
          })
          .then(() => {
            toBottom()
          })
        const parts = sync.data.part[message.id]
        prompt.set(
          parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        dialog.clear()
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      keybind: "messages_redo",
      disabled: !session()?.revert?.messageID,
      category: "Session",
      onSelect: (dialog) => {
        dialog.clear()
        const messageID = session().revert?.messageID
        if (!messageID) return
        const message = messages().find((x) => x.role === "user" && x.id > messageID)
        if (!message) {
          sdk.client.session.unrevert({
            sessionID: route.sessionID,
          })
          prompt.set({ input: "", parts: [] })
          return
        }
        sdk.client.session.revert({
          sessionID: route.sessionID,
          messageID: message.id,
        })
      },
    },
    {
      title: usernameVisible() ? "Hide username" : "Show username",
      value: "session.username_visible.toggle",
      keybind: "username_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setUsernameVisible((prev) => {
          const next = !prev
          kv.set("username_visible", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: "Toggle code concealment",
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal" as any,
      category: "Session",
      onSelect: (dialog) => {
        setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showTimestamps() ? "Hide timestamps" : "Show timestamps",
      value: "session.toggle.timestamps",
      category: "Session",
      onSelect: (dialog) => {
        setShowTimestamps((prev) => {
          const next = !prev
          kv.set("timestamps", next ? "show" : "hide")
          return next
        })
        dialog.clear()
      },
    },
    {
      title: showThinking() ? "Hide thinking" : "Show thinking",
      value: "session.toggle.thinking",
      keybind: "thinking_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setShowThinking((prev) => {
          const next = !prev
          kv.set("thinking_visibility", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: "Toggle diff wrapping",
      value: "session.toggle.diffwrap",
      category: "Session",
      onSelect: (dialog) => {
        setDiffWrapMode((prev) => (prev === "word" ? "none" : "word"))
        dialog.clear()
      },
    },
    {
      title: showDetails() ? "Hide tool details" : "Show tool details",
      value: "session.toggle.actions",
      keybind: "tool_details",
      category: "Session",
      onSelect: (dialog) => {
        const newValue = !showDetails()
        setShowDetails(newValue)
        kv.set("tool_details_visibility", newValue)
        dialog.clear()
      },
    },
    {
      title: showSidebar() ? "Hide sidebar" : "Show sidebar",
      value: "session.toggle.sidebar",
      keybind: "sidebar_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setShowSidebar((prev) => {
          const next = !prev
          kv.set("sidebar_visible", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: kv.get("copy_button_enabled", false) ? "Hide copy button" : "Show copy button",
      value: "session.toggle.copy_button",
      category: "Session",
      onSelect: (dialog) => {
        const current = kv.get("copy_button_enabled", false)
        kv.set("copy_button_enabled", !current)
        dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      value: "session.toggle.scrollbar",
      keybind: "scrollbar_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setShowScrollbar((prev) => {
          const next = !prev
          kv.set("scrollbar_visible", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: "Page up",
      value: "session.page.up",
      keybind: "messages_page_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      keybind: "messages_page_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      keybind: "messages_half_page_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      keybind: "messages_half_page_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      keybind: "messages_first",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      keybind: "messages_last",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      value: "session.messages_last_user",
      keybind: "messages_last_user",
      category: "Session",
      onSelect: () => {
        const messages = sync.data.message[route.sessionID]
        if (!messages || !messages.length) return

        // Find the most recent user message with non-ignored, non-synthetic text parts
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i]
          if (!message || message.role !== "user") continue

          const parts = sync.data.part[message.id]
          if (!parts || !Array.isArray(parts)) continue

          const hasValidTextPart = parts.some(
            (part) => part && part.type === "text" && !part.synthetic && !part.ignored,
          )

          if (hasValidTextPart) {
            const child = scroll.getChildren().find((child) => {
              return child.id === message.id
            })
            if (child) scroll.scrollBy(child.y - scroll.y - 1)
            break
          }
        }
      },
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      keybind: "messages_copy",
      category: "Session",
      onSelect: (dialog) => {
        const lastAssistantMessage = messages().findLast((msg) => msg.role === "assistant")
        if (!lastAssistantMessage) {
          toast.show({ message: "No assistant messages found", variant: "error" })
          dialog.clear()
          return
        }

        const parts = sync.data.part[lastAssistantMessage.id] ?? []
        const textParts = parts.filter((part) => part.type === "text")
        if (textParts.length === 0) {
          toast.show({ message: "No text parts found in last assistant message", variant: "error" })
          dialog.clear()
          return
        }

        const text = textParts
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!text) {
          toast.show({
            message: "No text content found in last assistant message",
            variant: "error",
          })
          dialog.clear()
          return
        }

        const base64 = Buffer.from(text).toString("base64")
        const osc52 = `\x1b]52;c;${base64}\x07`
        const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
        /* @ts-expect-error */
        renderer.writeOut(finalOsc52)
        Clipboard.copy(text).catch(() => toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Copy session transcript",
      value: "session.copy",
      keybind: "session_copy",
      category: "Session",
      onSelect: async (dialog) => {
        try {
          // Format session transcript as markdown
          const sessionData = session()
          const sessionMessages = messages()

          let transcript = `# ${sessionData.title}\n\n`
          transcript += `**Session ID:** ${sessionData.id}\n`
          transcript += `**Created:** ${new Date(sessionData.time.created).toLocaleString()}\n`
          transcript += `**Updated:** ${new Date(sessionData.time.updated).toLocaleString()}\n\n`
          transcript += `---\n\n`

          for (const msg of sessionMessages) {
            const parts = sync.data.part[msg.id] ?? []
            const role = msg.role === "user" ? "User" : "Assistant"
            transcript += `## ${role}\n\n`

            for (const part of parts) {
              if (part.type === "text" && !part.synthetic) {
                transcript += `${part.text}\n\n`
              } else if (part.type === "tool") {
                transcript += `\`\`\`\nTool: ${part.tool}\n\`\`\`\n\n`
              }
            }

            transcript += `---\n\n`
          }

          // Copy to clipboard
          await Clipboard.copy(transcript)
        } catch (error) {
          toast.show({ message: "Failed to copy session transcript", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Export session transcript to file",
      value: "session.export",
      keybind: "session_export",
      category: "Session",
      onSelect: async (dialog) => {
        try {
          // Format session transcript as markdown
          const sessionData = session()
          const sessionMessages = messages()

          let transcript = `# ${sessionData.title}\n\n`
          transcript += `**Session ID:** ${sessionData.id}\n`
          transcript += `**Created:** ${new Date(sessionData.time.created).toLocaleString()}\n`
          transcript += `**Updated:** ${new Date(sessionData.time.updated).toLocaleString()}\n\n`
          transcript += `---\n\n`

          for (const msg of sessionMessages) {
            const parts = sync.data.part[msg.id] ?? []
            const role = msg.role === "user" ? "User" : "Assistant"
            transcript += `## ${role}\n\n`

            for (const part of parts) {
              if (part.type === "text" && !part.synthetic) {
                transcript += `${part.text}\n\n`
              } else if (part.type === "tool") {
                transcript += `\`\`\`\nTool: ${part.tool}\n\`\`\`\n\n`
              }
            }

            transcript += `---\n\n`
          }

          // Prompt for optional filename
          const customFilename = await DialogPrompt.show(dialog, "Export filename", {
            value: `session-${sessionData.id.slice(0, 8)}.md`,
          })

          // Cancel if user pressed escape
          if (customFilename === null) return

          // Save to file in current working directory
          const exportDir = process.cwd()
          const filename = customFilename.trim()
          const filepath = path.join(exportDir, filename)

          await Bun.write(filepath, transcript)

          // Open with EDITOR if available
          const result = await Editor.open({ value: transcript, renderer })
          if (result !== undefined) {
            // User edited the file, save the changes
            await Bun.write(filepath, result)
          }

          toast.show({ message: `Session exported to ${filename}`, variant: "success" })
        } catch (error) {
          toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Next child session",
      value: "session.child.next",
      keybind: "session_child_cycle",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        moveChild(1)
        dialog.clear()
      },
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      keybind: "session_child_cycle_reverse",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        moveChild(-1)
        dialog.clear()
      },
    },
  ])

  const revertInfo = createMemo(() => session()?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)

  const revertDiffFiles = createMemo(() => {
    const diffText = revertInfo()?.diff ?? ""
    if (!diffText) return []

    try {
      const patches = parsePatch(diffText)
      return patches.map((patch) => {
        const filename = patch.newFileName || patch.oldFileName || "unknown"
        const cleanFilename = filename.replace(/^[ab]\//, "")
        return {
          filename: cleanFilename,
          additions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length,
            0,
          ),
          deletions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length,
            0,
          ),
        }
      })
    } catch (error) {
      return []
    }
  })

  const revertRevertedMessages = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return []
    return messages().filter((x) => x.id >= messageID && x.role === "user")
  })

  const revert = createMemo(() => {
    const info = revertInfo()
    if (!info) return
    if (!info.messageID) return
    return {
      messageID: info.messageID,
      reverted: revertRevertedMessages(),
      diff: info.diff,
      diffFiles: revertDiffFiles(),
    }
  })

  const dialog = useDialog()
  const renderer = useRenderer()

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))
  createEffect(
    on(showSidebar, (value, prev) => {
      if (prev === undefined) return
      renderer.currentRenderBuffer.clear()
      renderer.requestRender()
    }),
  )

  // Clear render buffer when session goes back to idle after cancellation
  // This fixes layout corruption that persists after cancelling large messages
  createEffect(() => {
    const status = sync.data.session_status[route.sessionID]
    if (status?.type === "idle") {
      // Small delay to ensure all state updates have completed
      setTimeout(() => {
        renderer.currentRenderBuffer.clear()
        renderer.requestRender()
      }, 50)
    }
  })

  // Auto-navigate to first benchmark slot if session has no messages but has benchmark
  createEffect(() => {
    const currentSession = session()
    const currentMessages = messages()

    if (currentSession && currentMessages.length === 0) {
      if (currentSession.benchmark?.type === "parent") {
        const children = currentSession.benchmark.children
        if (children && children.length > 0) {
          const firstChild = children[0]
          navigate({
            type: "session",
            sessionID: firstChild.sessionID,
          })
        }
      }
    }
  })

  return (
    <context.Provider
      value={{
        get width() {
          return contentWidth()
        },
        conceal,
        showThinking,
        showTimestamps,
        usernameVisible,
        showDetails,
        userMessageMarkdown,
        diffWrapMode,
        interruptCount,
        sync,
      }}
    >
      <box flexDirection="row">
        <box flexGrow={1} paddingBottom={1} paddingTop={1} gap={1}>
          <Show when={session()}>
            <scrollbox
              ref={(r) => (scroll = r)}
              paddingLeft="0.5%"
              paddingRight="0.5%"
              viewportOptions={{
                paddingRight: 1,
              }}
              verticalScrollbarOptions={{
                visible: showScrollbar(),
                width: 1,
                trackOptions: {
                  backgroundColor: RGBA.fromInts(0, 0, 0, 0),
                  foregroundColor: theme.textMuted,
                  width: 1,
                },
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
              scrollAcceleration={scrollAcceleration()}
            >
              <For each={messages()}>
                {(message, index) => (
                  <Switch>
                    <Match when={message.id === revert()?.messageID}>
                      {(function () {
                        const command = useCommandDialog()
                        const [hover, setHover] = createSignal(false)
                        const dialog = useDialog()

                        const handleUnrevert = async () => {
                          const confirmed = await DialogConfirm.show(
                            dialog,
                            "Confirm Redo",
                            "Are you sure you want to restore the reverted messages?",
                          )
                          if (confirmed) {
                            command.trigger("session.redo")
                          }
                        }

                        return (
                          <box
                            onMouseOver={() => setHover(true)}
                            onMouseOut={() => setHover(false)}
                            onMouseUp={handleUnrevert}
                            marginTop={1}
                            flexShrink={0}
                            border={["left"]}
                            customBorderChars={SplitBorder.customBorderChars}
                            borderColor={theme.backgroundPanel}
                          >
                            <box
                              paddingTop={1}
                              paddingBottom={1}
                              paddingLeft={2}
                              backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
                            >
                              <text fg={theme.textMuted}>{revert()!.reverted.length} message reverted</text>
                              <text fg={theme.textMuted}>
                                <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> or /redo to
                                restore
                              </text>
                              <Show when={revert()!.diffFiles?.length}>
                                <box marginTop={1}>
                                  <For each={revert()!.diffFiles}>
                                    {(file) => (
                                      <text fg={theme.text}>
                                        {file.filename}
                                        <Show when={file.additions > 0}>
                                          <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                                        </Show>
                                        <Show when={file.deletions > 0}>
                                          <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                                        </Show>
                                      </text>
                                    )}
                                  </For>
                                </box>
                              </Show>
                            </box>
                          </box>
                        )
                      })()}
                    </Match>
                    <Match when={revert()?.messageID && message.id >= revert()!.messageID}>
                      <></>
                    </Match>
                    <Match when={message.role === "user"}>
                      <UserMessage
                        index={index()}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          dialog.replace(() => (
                            <DialogMessage
                              messageID={message.id}
                              sessionID={route.sessionID}
                              setPrompt={(promptInfo) => prompt.set(promptInfo)}
                            />
                          ))
                        }}
                        message={message as UserMessage}
                        parts={sync.data.part[message.id] ?? []}
                        pending={pending()}
                      />
                    </Match>
                    <Match when={message.role === "assistant"}>
                      <AssistantMessage
                        last={lastAssistant()?.id === message.id}
                        message={message as AssistantMessage}
                        parts={sync.data.part[message.id] ?? []}
                      />
                    </Match>
                  </Switch>
                )}
              </For>
            </scrollbox>
            <box
              flexShrink={0}
              onMouseScroll={(event) => {
                if (!scroll || !event.scroll) return
                const direction = event.scroll.direction === "up" ? -1 : event.scroll.direction === "down" ? 1 : 0
                if (direction === 0) return
                scroll.scrollBy(event.scroll.delta * direction)
                event.preventDefault()
                event.stopPropagation()
              }}
            >
              <Prompt
                ref={(r) => {
                  prompt = r
                  promptRef.set(r)
                }}
                disabled={permissions().length > 0}
                onSubmit={() => {
                  toBottom()
                }}
                onInterrupt={(count) => setInterruptCount(count)}
                sessionID={route.sessionID}
                exitConfirmation={exitConfirmation()}
              />
            </box>
            <Footer />
          </Show>
          <Toast />
        </box>
        <Show when={showSidebar() && session()}>
          <Sidebar
            sessionID={route.sessionID}
            onHide={() => {
              setShowSidebar(false)
              kv.set("sidebar_visible", false)
            }}
          />
        </Show>
      </box>
    </context.Provider>
  )
}

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  index: number
  pending?: string
  onMouseUp: () => void
}) {
  const ctx = use()
  const text = createMemo(() => {
    const textParts = props.parts.flatMap((x) => (x.type === "text" ? [x as TextPart] : []))
    return textParts.find((part) => !part.synthetic) ?? textParts[0]
  })
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const { theme } = useTheme()
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  const contentWidth = createMemo(() => {
    const textContent = text()?.text ?? ""
    const lines = textContent.split("\n")
    const longestLineLen = lines.reduce((max, line) => Math.max(max, line.length), 0)
    const filesLen = files().reduce((acc, f) => acc + 2 + (f.filename?.length ?? 0) + 1, 0)
    return Math.max(10, Math.min(longestLineLen + filesLen + 4, ctx.width - 4))
  })

  const textWidth = createMemo(() => Math.max(10, ctx.width - 8))

  const line = createMemo(() => "─".repeat(contentWidth()))

  return (
    <>
      <Show when={text()}>
        <box id={props.message.id} marginTop={1} flexDirection="column" gap={0}>
          <text fg={theme.textMuted}>{line()}</text>
          <box flexDirection="row" gap={1}>
            <text fg={theme.primary} attributes={TextAttributes.BOLD}>
              {"▶"}
            </text>
            <box flexGrow={1} flexShrink={1} flexDirection="column" gap={0}>
              <box flexDirection="row" flexWrap="wrap" gap={1} onMouseUp={props.onMouseUp}>
                <text fg={theme.text} wrapMode="word" width={textWidth()}>
                  {formatUserText(text()?.text ?? "")}
                </text>
                <Show when={files().length}>
                  <For each={files()}>
                    {(file) => {
                      const label = createMemo(() => {
                        if (file.mime.startsWith("image/")) return "[Image]"
                        if (file.filename) return `[${file.filename}]`
                        return "[File]"
                      })
                      return (
                        <text fg={theme.textMuted}>
                          {label()}
                        </text>
                      )
                    }}
                  </For>
                </Show>
              </box>
              <Show when={queued()}>
                <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                  QUEUED
                </text>
              </Show>
              <Show when={!queued() && ctx.showTimestamps()}>
                <text fg={theme.textMuted}>{Locale.todayTimeOrDateTime(props.message.time.created)}</text>
              </Show>
            </box>
          </box>
          <text fg={theme.textMuted}>{line()}</text>
        </box>
      </Show>
      <Show when={compaction()}>
        <box
          marginTop={1}
          border={["top"]}
          title=" Compaction "
          titleAlignment="center"
          borderColor={theme.borderActive}
        />
      </Show>
    </>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])
  const textOrder = createMemo(() => {
    const order = new Map<string, number>()
    let count = 0
    for (const part of props.parts) {
      if (part.type === "text") {
        order.set(part.id, count++)
      }
    }
    return order
  })

  const duration = createMemo(() => {
    if (!props.message.time.completed) return 0
    // Don't show duration if message was cancelled/aborted and has no finish reason
    if (!props.message.finish) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    if (!user || !user.time) return 0
    return props.message.time.completed - user.time.created
  })

  const isLastOfTurn = createMemo(() => {
    const msgs = messages()
    const index = msgs.findIndex((x) => x.id === props.message.id)
    if (index === -1) return false
    const next = msgs[index + 1]
    return !next || next.role === "user"
  })

  const isPending = createMemo(() => {
    // only show loader if message is incomplete AND session is still working
    // this prevents the loader from staying visible after cancel/error
    if (props.message.time.completed) return false
    if (props.parts.length > 0) return false
    if (props.message.error) return false
    const status = sync.data.session_status[props.message.sessionID]
    return status?.type !== "idle"
  })

  return (
    <>
      <Show when={isPending()}>
        {(() => {
          const [word, setWord] = createSignal(getRandomWord())
          const keybind = useKeybind()
          const ctx = use()
          onMount(() => {
            const timer = setInterval(() => setWord(getRandomWord()), 4000)
            onCleanup(() => clearInterval(timer))
          })
          const frames = createMemo(() =>
            createShimmerFrames(word(), { color: theme.primary, baseColor: theme.textMuted }),
          )
          const colors = createMemo(() =>
            createShimmerColors(word(), { color: theme.primary, baseColor: theme.textMuted }),
          )
          return (
            <box marginTop={1} flexDirection="row" gap={1}>
              {/* @ts-ignore */}
              <spinner frames={frames()} color={colors()} interval={60} />
              <text fg={ctx.interruptCount() > 0 ? theme.primary : theme.textMuted}>
                (press {keybind.print("session_interrupt")}
                {ctx.interruptCount() > 0 ? " again" : ""} to interrupt)
              </text>
            </box>
          )
        })()}
      </Show>
      <For each={props.parts}>
        {(part, index) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          const extra = createMemo(() => (part.type === "text" ? { textIndex: textOrder().get(part.id) ?? 0 } : {}))
          return (
            <Show when={component()}>
              <Dynamic
                last={index() === props.parts.length - 1}
                component={component()}
                part={part as any}
                message={props.message}
                {...extra()}
              />
            </Show>
          )
        }}
      </For>
      <Show when={isLastOfTurn() && duration() > 0 && props.parts.length > 0}>
        <box paddingLeft={2} marginTop={1}>
          <text fg={theme.textMuted}>{Locale.duration(duration())}</text>
        </box>
      </Show>
      <Show when={props.message.error}>
        <text fg={theme.error}>{props.message.error?.data.message}</text>
      </Show>
    </>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = use()
  const keybind = useKeybind()
  const content = createMemo(() => props.part.text.replace("[REDACTED]", "").trim())
  const isThinking = createMemo(() => !props.part.time?.end)
  const duration = createMemo(() => {
    if (!props.part.time) return
    const end = props.part.time.end ?? Date.now()
    return end - props.part.time.start
  })

  return (
    <Show when={content()}>
      {(text) => (
        <Switch>
          <Match when={ctx.showThinking()}>
            <box paddingLeft={1} paddingRight={1} flexDirection="row">
              <Markdown content={"_Thinking:_ " + text()} conceal={ctx.conceal()} streaming={isThinking()} />
            </box>
          </Match>
          <Match when={true}>
            <box paddingLeft={0} marginTop={1}>
              <Show
                when={isThinking()}
                fallback={
                  <text fg={theme.textMuted}>
                    Thought for {duration() ? Locale.duration(duration()!) : "a moment"}
                    <Show when={keybind.print("thinking_toggle")}>{(hint) => <> · {hint()} to view</>}</Show>
                  </text>
                }
              >
                {(() => {
                  const thinkingText = "Thinking"
                  const frames = createMemo(() =>
                    createShimmerFrames(thinkingText, { color: theme.text, baseColor: theme.textMuted }),
                  )
                  const colors = createMemo(() =>
                    createShimmerColors(thinkingText, { color: theme.text, baseColor: theme.textMuted }),
                  )
                  return (
                    <box flexDirection="row">
                      {/* @ts-ignore */}
                      <spinner frames={frames()} color={colors()} interval={60} />
                      <Show when={keybind.print("thinking_toggle")}>
                        {(hint) => <text fg={theme.textMuted}> · {hint()} to view</text>}
                      </Show>
                    </box>
                  )
                })()}
              </Show>
            </box>
          </Match>
        </Switch>
      )}
    </Show>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage; textIndex?: number }) {
  const ctx = use()
  const { theme } = useTheme()
  const isFirst = () => props.textIndex === 0
  const isStreaming = () => !props.message.time.completed
  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} marginTop={isFirst() ? 1 : 0} flexDirection="row" gap={1}>
        <Show when={isFirst()}>
          <text fg={theme.primary}>●</text>
        </Show>
        <Show when={!isFirst()}>
          <text> </text>
        </Show>
        <box flexGrow={1} flexShrink={1}>
          <Markdown content={props.part.text.trim()} conceal={ctx.conceal()} streaming={isStreaming()} />
        </box>
      </box>
    </Show>
  )
}

function formatUserText(value: string) {
  if (!value.trim()) return ""
  return value
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const { theme } = useTheme()
  const { showDetails } = use()
  const sync = useSync()
  const [margin, setMargin] = createSignal(0)
  const component = createMemo(() => {
    // Always show these important tools regardless of showDetails setting
    const alwaysVisible = ["read", "write", "edit", "bash", "task", "patch"]
    const isAlwaysVisible = alwaysVisible.includes(props.part.tool)

    // Hide tool if showDetails is false and tool completed successfully
    // But always show if there's an error, permission is required, or it's an important tool
    if (!isAlwaysVisible) {
      const shouldHide =
        !showDetails() &&
        props.part.state.status === "completed" &&
        !sync.data.permission[props.message.sessionID]?.some((x) => x.callID === props.part.callID)

      if (shouldHide) {
        return undefined
      }
    }

    const render = ToolRegistry.render(props.part.tool) ?? GenericTool

    const metadata = props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    const input = props.part.state.input ?? {}
    const container = ToolRegistry.container(props.part.tool)
    const permissions = sync.data.permission[props.message.sessionID] ?? []
    const permissionIndex = permissions.findIndex((x) => x.callID === props.part.callID)
    const permission = permissions[permissionIndex]

    const style: BoxProps =
      container === "block" || permission
        ? {
            border: permissionIndex === 0 ? (["left", "right"] as const) : (["left"] as const),
            paddingTop: 1,
            paddingBottom: 1,
            paddingLeft: 2,
            marginTop: 1,
            gap: 1,
            customBorderChars: SplitBorder.customBorderChars,
            borderColor: permissionIndex === 0 ? theme.warning : theme.borderSubtle,
          }
        : {
            paddingLeft: 3,
            gap: 0,
            flexDirection: "column" as const,
          }

    return (
      <box
        marginTop={margin()}
        {...style}
        renderBefore={function () {
          const el = this as BoxRenderable
          const parent = el.parent
          if (!parent) {
            return
          }
          if (el.height > 1) {
            setMargin(1)
            return
          }
          const children = parent.getChildren()
          const index = children.indexOf(el)
          const previous = children[index - 1]
          if (!previous) {
            setMargin(0)
            return
          }
          if (previous.height > 1 || previous.id.startsWith("text-")) {
            setMargin(1)
            return
          }
        }}
      >
        <Dynamic
          component={render}
          input={input}
          tool={props.part.tool}
          metadata={metadata}
          permission={permission?.metadata ?? {}}
          output={props.part.state.status === "completed" ? props.part.state.output : undefined}
        />
        {props.part.state.status === "error" && (
          <box paddingLeft={2}>
            <text fg={theme.error}>{props.part.state.error.replace("Error: ", "")}</text>
          </box>
        )}
        {permission && (
          <box gap={1}>
            <text fg={theme.text}>Permission required to run this tool:</text>
            <box flexDirection="row" gap={2}>
              <text fg={theme.text}>
                <b>enter</b>
                <span style={{ fg: theme.textMuted }}> accept</span>
              </text>
              <text fg={theme.text}>
                <b>a</b>
                <span style={{ fg: theme.textMuted }}> accept always</span>
              </text>
              <text fg={theme.text}>
                <b>d</b>
                <span style={{ fg: theme.textMuted }}> deny</span>
              </text>
            </box>
          </box>
        )}
      </box>
    )
  })

  return <Show when={component()}>{component()}</Show>
}

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, any>
  tool: string
  output?: string
}
function GenericTool(props: ToolProps<any>) {
  return (
    <ToolTitle fallback="Writing command..." when={true}>
      {props.tool}({input(props.input)})
    </ToolTitle>
  )
}

type ToolRegistration<T extends Tool.Info = any> = {
  name: string
  container: "inline" | "block"
  render?: Component<ToolProps<T>>
}
const ToolRegistry = (() => {
  const state: Record<string, ToolRegistration> = {}
  function register<T extends Tool.Info>(input: ToolRegistration<T>) {
    state[input.name] = input
    return input
  }
  return {
    register,
    container(name: string) {
      return state[name]?.container
    },
    render(name: string) {
      return state[name]?.render
    },
  }
})()

function ToolTitle(props: {
  fallback: string
  when: any
  icon?: string
  children: JSX.Element
  summary?: string
  filePath?: string
}) {
  const { theme } = useTheme()
  const [hoverWithCtrl, setHoverWithCtrl] = createSignal(false)

  const handleClick = (evt: import("@opentui/core").MouseEvent) => {
    if (!props.filePath) return
    if (!evt.modifiers.ctrl) return
    Ide.openFile(props.filePath)
  }

  const handleMouseOver = (evt: import("@opentui/core").MouseEvent) => {
    if (props.filePath && evt.modifiers.ctrl) setHoverWithCtrl(true)
  }

  const handleMouseOut = () => {
    setHoverWithCtrl(false)
  }

  const handleMouseMove = (evt: import("@opentui/core").MouseEvent) => {
    if (!props.filePath) return
    setHoverWithCtrl(evt.modifiers.ctrl)
  }

  return (
    <box flexDirection="column" gap={0}>
      <text
        fg={props.when ? theme.text : theme.textMuted}
        attributes={hoverWithCtrl() ? TextAttributes.UNDERLINE : undefined}
        onMouseUp={handleClick}
        onMouseOver={handleMouseOver}
        onMouseOut={handleMouseOut}
        onMouseMove={handleMouseMove}
      >
        <Show fallback={<>~ {props.fallback}</>} when={props.when}>
          <span style={{ fg: theme.primary }}>●</span> {props.children}
        </Show>
      </text>
      <Show when={props.summary}>
        <text fg={theme.textMuted}>
          {"  "}⎿ {props.summary}
        </text>
      </Show>
    </box>
  )
}

ToolRegistry.register<typeof BashTool>({
  name: "bash",
  container: "block",
  render(props) {
    const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
    const { theme } = useTheme()
    return (
      <>
        <ToolTitle fallback="Writing command..." when={props.input.command}>
          Bash({props.input.description || "Shell"})
        </ToolTitle>
        <Show when={props.input.command}>
          <text fg={theme.text}>$ {props.input.command}</text>
        </Show>
        <Show when={output()}>
          <box>
            <text fg={theme.text}>{output()}</text>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof ReadTool>({
  name: "read",
  container: "inline",
  render(props) {
    const summary = createMemo(() => {
      const metadata = props.metadata as any
      if (!metadata.lines) return undefined
      return `Read ${metadata.lines} lines`
    })
    return (
      <>
        <ToolTitle
          fallback="Reading file..."
          when={props.input.filePath}
          summary={summary()}
          filePath={props.input.filePath}
        >
          Read({normalizePath(props.input.filePath!)})
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof WriteTool>({
  name: "write",
  container: "block",
  render(props) {
    const { theme, syntax } = useTheme()
    const code = createMemo(() => {
      if (!props.input.content) return ""
      return props.input.content
    })

    const diagnostics = createMemo(() => props.metadata.diagnostics?.[props.input.filePath ?? ""] ?? [])

    const summary = createMemo(() => {
      if (!props.input.content) return undefined
      const lines = props.input.content.split("\n").length
      return `Wrote ${lines} lines`
    })

    return (
      <>
        <ToolTitle
          fallback="Preparing write..."
          when={props.input.filePath}
          summary={summary()}
          filePath={props.input.filePath}
        >
          Write({normalizePath(props.input.filePath!)})
        </ToolTitle>
        <line_number fg={theme.textMuted} bg={theme.backgroundPanel} minWidth={3} paddingRight={1}>
          <code
            conceal={false}
            fg={theme.text}
            bg={theme.backgroundPanel}
            filetype={filetype(props.input.filePath!)}
            syntaxStyle={syntax()}
            content={code()}
          />
        </line_number>
        <Show when={diagnostics().length}>
          <For each={diagnostics()}>
            {(diagnostic) => (
              <text fg={theme.error}>
                Error [{diagnostic.range.start.line}:{diagnostic.range.start.character}]: {diagnostic.message}
              </text>
            )}
          </For>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof GlobTool>({
  name: "glob",
  container: "inline",
  render(props) {
    const summary = createMemo(() => {
      if (!props.metadata.count) return undefined
      return `${props.metadata.count} matches`
    })
    return (
      <>
        <ToolTitle fallback="Finding files..." when={props.input.pattern} summary={summary()}>
          Glob("{props.input.pattern}"<Show when={props.input.path}>, {normalizePath(props.input.path)}</Show>)
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof GrepTool>({
  name: "grep",
  container: "inline",
  render(props) {
    const summary = createMemo(() => {
      if (!props.metadata.matches) return undefined
      return `${props.metadata.matches} matches`
    })
    return (
      <ToolTitle fallback="Searching content..." when={props.input.pattern} summary={summary()}>
        Grep("{props.input.pattern}"<Show when={props.input.path}>, {normalizePath(props.input.path)}</Show>)
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof ListTool>({
  name: "list",
  container: "inline",
  render(props) {
    const dir = createMemo(() => {
      if (props.input.path) {
        return normalizePath(props.input.path)
      }
      return ""
    })
    return (
      <>
        <ToolTitle fallback="Listing directory..." when={props.input.path !== undefined} filePath={props.input.path}>
          List({dir()})
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof TaskTool>({
  name: "task",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    const keybind = useKeybind()

    return (
      <>
        <ToolTitle fallback="Delegating..." when={props.input.subagent_type ?? props.input.description}>
          Task({Locale.titlecase(props.input.subagent_type ?? "unknown")}, "{props.input.description}")
        </ToolTitle>
        <Show when={props.metadata.summary?.length}>
          <box>
            <For each={props.metadata.summary ?? []}>
              {(task, index) => {
                const summary = props.metadata.summary ?? []
                return (
                  <text style={{ fg: task.state.status === "error" ? theme.error : theme.textMuted }}>
                    {index() === summary.length - 1 ? "└" : "├"} {Locale.titlecase(task.tool)}{" "}
                    {task.state.status === "completed" ? task.state.title : ""}
                  </text>
                )
              }}
            </For>
          </box>
        </Show>
        <text fg={theme.text}>
          {keybind.print("session_child_cycle")}, {keybind.print("session_child_cycle_reverse")}
          <span style={{ fg: theme.textMuted }}> to navigate between subagent sessions</span>
        </text>
      </>
    )
  },
})

ToolRegistry.register<typeof WebFetchTool>({
  name: "webfetch",
  container: "inline",
  render(props) {
    return (
      <ToolTitle fallback="Fetching from the web..." when={(props.input as any).url}>
        WebFetch({(props.input as any).url})
      </ToolTitle>
    )
  },
})

ToolRegistry.register({
  name: "codesearch",
  container: "inline",
  render(props: ToolProps<any>) {
    const input = props.input as any
    const metadata = props.metadata as any
    const summary = createMemo(() => {
      if (!metadata.results) return undefined
      return `${metadata.results} results`
    })
    return (
      <ToolTitle fallback="Searching code..." when={input.query} summary={summary()}>
        CodeSearch("{input.query}")
      </ToolTitle>
    )
  },
})

ToolRegistry.register({
  name: "websearch",
  container: "inline",
  render(props: ToolProps<any>) {
    const input = props.input as any
    const metadata = props.metadata as any
    const summary = createMemo(() => {
      if (!metadata.numResults) return undefined
      return `${metadata.numResults} results`
    })
    return (
      <ToolTitle fallback="Searching web..." when={input.query} summary={summary()}>
        WebSearch("{input.query}")
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof EditTool>({
  name: "edit",
  container: "block",
  render(props) {
    const ctx = use()
    const { theme, syntax } = useTheme()

    const view = createMemo(() => {
      const diffStyle = ctx.sync.data.config.tui?.diff_style
      if (diffStyle === "stacked") return "unified"
      // Default to "auto" behavior
      return ctx.width > 120 ? "split" : "unified"
    })

    const ft = createMemo(() => filetype(props.input.filePath))

    const diffContent = createMemo(() => props.metadata.diff ?? props.permission["diff"])

    const diagnostics = createMemo(() => {
      const arr = props.metadata.diagnostics?.[props.input.filePath ?? ""] ?? []
      return arr.filter((x) => x.severity === 1).slice(0, 3)
    })

    const summary = createMemo(() => {
      const metadata = props.metadata as any
      const added = metadata.additions
      const removed = metadata.deletions
      if (added === undefined && removed === undefined) return undefined
      const parts = []
      if (added) parts.push(`Added ${added} lines`)
      if (removed) parts.push(`removed ${removed} lines`)
      return parts.join(", ")
    })

    return (
      <>
        <ToolTitle
          fallback="Preparing edit..."
          when={props.input.filePath}
          summary={summary()}
          filePath={props.input.filePath}
        >
          Update({normalizePath(props.input.filePath!)})
        </ToolTitle>
        <Show when={diffContent()}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
              fg={theme.textMuted}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
        </Show>
        <Show when={diagnostics().length}>
          <box>
            <For each={diagnostics()}>
              {(diagnostic) => (
                <text fg={theme.error}>
                  Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}
                </text>
              )}
            </For>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof PatchTool>({
  name: "patch",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    return (
      <>
        <ToolTitle fallback="Preparing patch..." when={true}>
          Patch()
        </ToolTitle>
        <Show when={props.output}>
          <box>
            <text fg={theme.text}>{props.output?.trim()}</text>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof TodoWriteTool>({
  name: "todowrite",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    return (
      <>
        <Show when={!props.input.todos?.length}>
          <ToolTitle fallback="Updating todos..." when={true}>
            TodoWrite()
          </ToolTitle>
        </Show>
        <Show when={props.metadata.todos?.length}>
          <box>
            <For each={props.input.todos ?? []}>
              {(todo) => (
                <text style={{ fg: todo.status === "in_progress" ? theme.success : theme.textMuted }}>
                  [{todo.status === "completed" ? "✓" : " "}] {todo.content}
                </text>
              )}
            </For>
          </box>
        </Show>
      </>
    )
  },
})

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) {
    return path.relative(process.cwd(), input) || "."
  }
  return input
}

function input(input: Record<string, any>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}
