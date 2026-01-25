import { Identifier } from "@/id/id"
import { Keybind } from "@/util/keybind"
import { Locale } from "@/util/locale"
import type { AssistantMessage, FilePart } from "@arctic-cli/sdk/v2"
import {
  BoxRenderable,
  MouseEvent,
  PasteEvent,
  TextareaRenderable,
  TextAttributes,
  type KeyBinding,
} from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { EmptyBorder } from "@tui/component/border"
import { useKeybind } from "@tui/context/keybind"
import { useLocal } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { Editor } from "@tui/util/editor"
import "opentui-spinner/solid"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useExit } from "../../context/exit"
import { TuiEvent } from "../../event"
import { Clipboard } from "../../util/clipboard"
import { useCommandDialog } from "../dialog-command"
import { Autocomplete, type AutocompleteRef } from "./autocomplete"
import { usePromptHistory, type PromptInfo } from "./history"

import { Pricing } from "@/provider/pricing"
import type { ProviderUsage } from "@/provider/usage"
import { useDialog } from "@tui/ui/dialog"
import { usePromptRef } from "../../context/prompt"
import { DialogAlert } from "../../ui/dialog-alert"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { DialogSelect } from "../../ui/dialog-select"
import { useToast } from "../../ui/toast"
import { DialogAgent } from "../dialog-agent"
import { DialogModel } from "../dialog-model"
import { DialogPrompts } from "../dialog-prompts"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"

async function fetchUsageRecord(input: {
  baseUrl?: string
  directory?: string
  sessionID?: string
  providerID: string
}) {
  if (!input.baseUrl) return undefined
  const url = new URL(`/usage/providers/${encodeURIComponent(input.providerID)}`, input.baseUrl)
  const res = await fetch(`${url}`, {
    headers: {
      ...(input.directory ? { "x-arctic-directory": input.directory } : {}),
      ...(input.sessionID ? { "x-arctic-session-id": input.sessionID } : {}),
      "x-arctic-time-period": "session",
    },
    credentials: "include",
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Request failed (${res.status}): ${body || res.statusText}`)
  }
  return (await res.json()) as ProviderUsage.Record
}

export type PromptProps = {
  sessionID?: string
  disabled?: boolean
  onSubmit?: () => void
  onInterrupt?: (count: number) => void
  ref?: (ref: PromptRef) => void
  hint?: JSX.Element
  showPlaceholder?: boolean
  exitConfirmation?: boolean
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
}

const PLACEHOLDERS = ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"]

const TEXTAREA_ACTIONS = [
  // "submit" and "newline" handled manually in onKeyDown
  // "submit",
  // "newline",
  "move-left",
  "move-right",
  "move-up",
  "move-down",
  "select-left",
  "select-right",
  "select-up",
  "select-down",
  "line-home",
  "line-end",
  "select-line-home",
  "select-line-end",
  "visual-line-home",
  "visual-line-end",
  "select-visual-line-home",
  "select-visual-line-end",
  "buffer-home",
  "buffer-end",
  "select-buffer-home",
  "select-buffer-end",
  "delete-line",
  "delete-to-line-end",
  "delete-to-line-start",
  "backspace",
  "delete",
  "undo",
  "redo",
  "word-forward",
  "word-backward",
  "select-word-forward",
  "select-word-backward",
  "delete-word-forward",
  "delete-word-backward",
] as const

function mapTextareaKeybindings(
  keybinds: Record<string, Keybind.Info[]>,
  action: (typeof TEXTAREA_ACTIONS)[number],
): KeyBinding[] {
  const configKey = `input_${action.replace(/-/g, "_")}`
  const bindings = keybinds[configKey]
  if (!bindings) return []
  return bindings.map((binding) => ({
    name: binding.name,
    ctrl: binding.ctrl || undefined,
    meta: binding.meta || undefined,
    shift: binding.shift || undefined,
    super: binding.super || undefined,
    action,
  }))
}

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const promptRef = usePromptRef()
  const { theme, syntax } = useTheme()
  const currentSession = createMemo(() => (props.sessionID ? sync.session.get(props.sessionID) : undefined))
  const displayModel = createMemo(() => {
    const benchmark = currentSession()?.benchmark
    const sessionModel = benchmark?.type === "child" ? benchmark.model : undefined
    const model = sessionModel ?? local.model.current()
    if (!model) return local.model.parsed()
    const provider = sync.data.provider.find((item) => item.id === model.providerID)
    const modelInfo = provider?.models?.[model.modelID]
    return {
      model: modelInfo?.name ?? model.modelID,
      provider: provider?.name ?? model.providerID,
    }
  })

  const safe = (fn: () => void) => {
    try {
      fn()
    } catch {}
  }

  const safeClearInput = () => {
    safe(() => input.extmarks.clear())
    safe(() => input.clear())
  }

  const safeFocusInput = () => {
    safe(() => input.focus())
  }

  const handleTextareaMouseDown = (event: MouseEvent) => {
    event.target?.focus()
  }

  // Calculate context usage
  const messages = createMemo(() => {
    if (!props.sessionID) return []
    return sync.data.message[props.sessionID] ?? []
  })

  const [sessionCost, setSessionCost] = createSignal<number | undefined>(undefined)
  const [dailyCost, setDailyCost] = createSignal<number | undefined>(undefined)
  const [usageLimits, setUsageLimits] = createSignal<
    | {
        percent?: number
        timeLeft?: string
      }
    | undefined
  >(undefined)

  const isCopilotModel = createMemo(() => {
    const model = local.model.current()
    if (!model) return false
    return model.providerID === "github-copilot" || model.providerID === "github-copilot-enterprise"
  })

  // Calculate session cost
  createEffect(() => {
    const msgs = messages()
    let cancelled = false
    let syncTotal = 0
    let syncHasPricing = false
    let needsAsync = false

    for (const msg of msgs) {
      if (msg.role === "assistant" && msg.tokens.output > 0) {
        const assistantMsg = msg as AssistantMessage
        const costBreakdown = Pricing.calculateCost(assistantMsg.modelID, {
          input: assistantMsg.tokens.input,
          output: assistantMsg.tokens.output,
          cacheCreation: assistantMsg.tokens.cache.write,
          cacheRead: assistantMsg.tokens.cache.read,
        })
        if (costBreakdown) {
          syncHasPricing = true
          syncTotal += costBreakdown.totalCost
        } else {
          needsAsync = true
        }
      }
    }

    setSessionCost(syncHasPricing ? syncTotal : undefined)

    if (needsAsync) {
      ;(async () => {
        let total = 0
        let hasPricing = false
        for (const msg of msgs) {
          if (msg.role === "assistant" && msg.tokens.output > 0) {
            const assistantMsg = msg as AssistantMessage
            const costBreakdown = await Pricing.calculateCostAsync(assistantMsg.modelID, {
              input: assistantMsg.tokens.input,
              output: assistantMsg.tokens.output,
              cacheCreation: assistantMsg.tokens.cache.write,
              cacheRead: assistantMsg.tokens.cache.read,
            })
            if (costBreakdown) {
              hasPricing = true
              total += costBreakdown.totalCost
            }
          }
        }
        if (!cancelled) setSessionCost(hasPricing ? total : undefined)
      })().catch(() => {})
    }

    onCleanup(() => {
      cancelled = true
    })
  })

  // Calculate daily cost
  createEffect(() => {
    const sessionID = props.sessionID
    if (!sessionID) return
    ;(async () => {
      const now = Date.now()
      const startOfDay = new Date(now)
      startOfDay.setHours(0, 0, 0, 0)
      const dayStart = startOfDay.getTime()

      let total = 0
      let hasPricing = false
      const allMessages = Object.values(sync.data.message).flat()

      for (const msg of allMessages) {
        if (msg.role === "assistant" && msg.tokens.output > 0) {
          const assistantMsg = msg as AssistantMessage
          const messageTime = assistantMsg.time?.completed ?? assistantMsg.time?.created
          if (!messageTime || messageTime < dayStart) continue

          const costBreakdown = await Pricing.calculateCostAsync(assistantMsg.modelID, {
            input: assistantMsg.tokens.input,
            output: assistantMsg.tokens.output,
            cacheCreation: assistantMsg.tokens.cache.write,
            cacheRead: assistantMsg.tokens.cache.read,
          })
          if (costBreakdown) {
            hasPricing = true
            total += costBreakdown.totalCost
          }
        }
      }

      setDailyCost(hasPricing ? total : undefined)
    })().catch(() => {})
  })

  // Fetch usage limits for reset time
  createEffect(() => {
    const model = local.model.current()
    if (!model) return
    const sessionID = props.sessionID
    if (!sessionID) return

    let cancelled = false
    const fetchLimits = async () => {
      const providerID = (() => {
        if (model.providerID === "minimax") {
          const hasCodingPlan = sync.data.provider.some((item) => item.id === "minimax-coding-plan")
          return hasCodingPlan ? "minimax-coding-plan" : model.providerID
        }
        return model.providerID
      })()

      const record = await fetchUsageRecord({
        baseUrl: sdk.url,
        directory: sync.data.path.directory,
        sessionID,
        providerID,
      }).catch(() => undefined)

      if (cancelled) return

      if (!record?.limits?.primary) {
        setUsageLimits(undefined)
        return
      }

      const primary = record.limits.primary
      let timeLeft: string | undefined
      if (primary.resetsAt) {
        const diff = primary.resetsAt * 1000 - Date.now()
        if (diff > 0) {
          const totalMinutes = Math.floor(diff / 60000)
          const hours = Math.floor(totalMinutes / 60)
          const minutes = totalMinutes % 60
          timeLeft = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
        }
      }

      const usedPercent = primary.usedPercent ?? undefined

      setUsageLimits({
        percent: usedPercent !== undefined ? usedPercent : undefined,
        timeLeft,
      })
    }

    fetchLimits()
    const interval = setInterval(fetchLimits, 60000)

    onCleanup(() => {
      cancelled = true
      clearInterval(interval)
    })
  })

  function promptModelWarning() {
    toast.show({
      variant: "warning",
      message: "Connect a provider to send prompts",
      duration: 3000,
    })
    if (sync.data.provider.length === 0) {
      dialog.replace(() => <DialogProviderConnect />)
    }
  }

  const textareaKeybindings = createMemo(() => {
    const keybinds = keybind.all

    return [
      // Override opentui's default return/linefeed bindings with "submit"/"newline" actions
      // We handle these in onKeyDown instead
      { name: "return", action: "submit" as any },
      ...TEXTAREA_ACTIONS.flatMap((action) => mapTextareaKeybindings(keybinds, action)),
    ] satisfies KeyBinding[]
  })

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId: number

  command.register(() => {
    return [
      {
        title: "Clear prompt",
        value: "prompt.clear",
        category: "Prompt",
        disabled: true,
        onSelect: (dialog) => {
          safeClearInput()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        disabled: true,
        keybind: "input_submit",
        category: "Prompt",
        onSelect: (dialog) => {
          if (!input.focused) return
          submit()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        value: "prompt.paste",
        disabled: false,
        keybind: "input_paste",
        category: "Prompt",
        onSelect: async () => {
          const content = await Clipboard.read()
          if (content?.mime.startsWith("image/")) {
            await pasteImage({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
          } else if (content?.mime === "text/plain") {
            // Paste text content from clipboard
            const text = content.data
            if (text) {
              input.insertText(text)
            }
          }
        },
      },
      {
        title: "Save prompt",
        value: "prompt.save",
        category: "Prompt",
        onSelect: async (dialog) => {
          await DialogPrompts.show(dialog, toast, "save", input.plainText)
          safeFocusInput()
        },
      },
      {
        title: "Use prompt",
        value: "prompt.use",
        category: "Prompt",
        onSelect: async (dialog) => {
          const result = await DialogPrompts.show(dialog, toast, "use", input.plainText)
          if (result) {
            const { prompt, mode } = result as { prompt: any; mode: "replace" | "append" }
            if (mode === "replace") {
              input.setText(prompt.content)
              setStore("prompt", {
                input: prompt.content,
                parts: [],
              })
              restoreExtmarksFromParts([])
              input.gotoBufferEnd()
            } else {
              const separator = input.plainText.trim() === "" ? "" : "\n\n"
              const newText = input.plainText + separator + prompt.content
              input.setText(newText)
              setStore("prompt", {
                input: newText,
                parts: store.prompt.parts,
              })
              restoreExtmarksFromParts(store.prompt.parts)
              input.gotoBufferEnd()
            }
          }
          safeFocusInput()
        },
      },
      {
        title: "List prompts",
        value: "prompt.list",
        category: "Prompt",
        onSelect: async (dialog) => {
          await DialogPrompts.show(dialog, toast, "list", input.plainText)
          safeFocusInput()
        },
      },
      {
        title: "Delete prompt",
        value: "prompt.delete",
        category: "Prompt",
        onSelect: async (dialog) => {
          await DialogPrompts.show(dialog, toast, "delete", input.plainText)
          safeFocusInput()
        },
      },
      {
        title: "Select model",
        value: "prompt.model",
        category: "Model",
        onSelect: (dialog) => {
          dialog.replace(() => <DialogModel />)
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        keybind: "session_interrupt",
        disabled: status().type === "idle",
        category: "Session",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          // TODO: this should be its own command
          if (store.mode === "shell") {
            setStore("mode", "normal")
            return
          }
          if (!props.sessionID) return

          const nextInterrupt = store.interrupt + 1
          setStore("interrupt", nextInterrupt)
          props.onInterrupt?.(nextInterrupt)

          setTimeout(() => {
            setStore("interrupt", 0)
            props.onInterrupt?.(0)
          }, 5000)

          if (nextInterrupt >= 2) {
            sdk.client.session.abort({
              sessionID: props.sessionID,
            })
            setStore("interrupt", 0)
            props.onInterrupt?.(0)
          }
          dialog.clear()
        },
      },
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        onSelect: async (dialog, trigger) => {
          dialog.clear()

          // replace summarized text parts with the actual text
          const text = store.prompt.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => {
              if (!p.source) return acc
              return acc.replace(p.source.text.value, p.text)
            }, store.prompt.input)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = trigger === "prompt" ? "" : text
          const content = await Editor.open({ value, renderer })
          if (!content) return

          input.setText(content)

          // Update positions for nonTextParts based on their location in new content
          // Filter out parts whose virtual text was deleted
          // this handles a case where the user edits the text in the editor
          // such that the virtual text moves around or is deleted
          const updatedNonTextParts = nonTextParts
            .map((part) => {
              let virtualText = ""
              if (part.type === "file" && part.source?.text) {
                virtualText = part.source.text.value
              } else if (part.type === "agent" && part.source) {
                virtualText = part.source.value
              }

              if (!virtualText) return part

              const newStart = content.indexOf(virtualText)
              // if the virtual text is deleted, remove the part
              if (newStart === -1) return null

              const newEnd = newStart + virtualText.length

              if (part.type === "file" && part.source?.text) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    text: {
                      ...part.source.text,
                      start: newStart,
                      end: newEnd,
                    },
                  },
                }
              }

              if (part.type === "agent" && part.source) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    start: newStart,
                    end: newEnd,
                  },
                }
              }

              return part
            })
            .filter((part) => part !== null)

          setStore("prompt", {
            input: content,
            // keep only the non-text parts because the text parts were
            // already expanded inline
            parts: updatedNonTextParts,
          })
          restoreExtmarksFromParts(updatedNonTextParts)
          input.cursorOffset = Bun.stringWidth(content)
        },
      },
    ]
  })

  sdk.event.on(TuiEvent.PromptAppend.type, (evt) => {
    input.insertText(evt.properties.text)
  })

  createEffect(() => {
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.text
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
  }>({
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })

  const inputPlaceholder = createMemo(() => {
    if (props.sessionID) return undefined
    return `Ask anything... "${PLACEHOLDERS[store.placeholder]}"`
  })

  createEffect(() => {
    safeFocusInput()
  })

  onMount(() => {
    promptPartTypeId = input.extmarks.registerType("prompt-part")
  })

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    safe(() => input.extmarks.clear())
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      let start = 0
      let end = 0
      let virtualText = ""
      let styleId: number | undefined

      if (part.type === "file" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = fileStyleId
      } else if (part.type === "agent" && part.source) {
        start = part.source.start
        end = part.source.end
        virtualText = part.source.value
        styleId = agentStyleId
      } else if (part.type === "text" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = pasteStyleId
      }

      if (virtualText) {
        const extmarkId = input.extmarks.create({
          start,
          end,
          virtual: true,
          styleId,
          typeId: promptPartTypeId,
        })
        setStore("extmarkToPartIndex", (map: Map<number, number>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, partIndex)
          return newMap
        })
      }
    })
  }

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex !== undefined) {
            const part = draft.prompt.parts[partIndex]
            if (part) {
              if (part.type === "agent" && part.source) {
                part.source.start = extmark.start
                part.source.end = extmark.end
              } else if (part.type === "file" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              } else if (part.type === "text" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              }
              newMap.set(extmark.id, newParts.length)
              newParts.push(part)
            }
          }
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )
  }

  props.ref?.({
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      safeClearInput()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
    },
  })

  async function submit() {
    if (props.disabled) return
    if (autocomplete.visible) return
    if (!store.prompt.input) return
    const trimmed = store.prompt.input.trim()
    if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
      exit()
      return
    }
    const slashTokenEarly = trimmed.startsWith("/") ? trimmed.split(/\s+/)[0] : undefined
    if (slashTokenEarly === "/benchmark") {
      const [, actionRaw] = trimmed.split(/\s+/)
      const action = (actionRaw ?? "").toLowerCase()
      if (action) {
        await handleBenchmarkCommand(action)
      } else {
        toast.show({
          variant: "warning",
          message: "Usage: /benchmark start|stop|next|prev|apply|undo",
          duration: 3000,
        })
      }
      safe(() => input.extmarks.clear())
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
      props.onSubmit?.()
      safeClearInput()
      return
    }
    const selectedModel = local.model.current()
    if (!selectedModel) {
      promptModelWarning()
      return
    }
    const benchmarkTargetSessionID = (() => {
      if (!props.sessionID) return undefined
      const current = sync.session.get(props.sessionID)
      if (current?.benchmark?.type === "child") return current.id
      if (current?.benchmark?.type === "parent") return current.id
      return props.sessionID
    })()
    const currentSessionID = props.sessionID
      ? props.sessionID
      : await (async () => {
          const sessionID = await sdk.client.session.create({}).then((x) => x.data!.id)
          return sessionID
        })()
    const promptSessionID = benchmarkTargetSessionID ?? currentSessionID
    const messageID = Identifier.ascending("message")
    let inputText = store.prompt.input

    // Expand pasted text inline before submitting
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    const sortedExtmarks = allExtmarks.sort((a: { start: number }, b: { start: number }) => b.start - a.start)

    for (const extmark of sortedExtmarks) {
      const partIndex = store.extmarkToPartIndex.get(extmark.id)
      if (partIndex !== undefined) {
        const part = store.prompt.parts[partIndex]
        if (part?.type === "text" && part.text) {
          const before = inputText.slice(0, extmark.start)
          const after = inputText.slice(extmark.end)
          inputText = before + part.text + after
        }
      }
    }

    // Filter out text parts (pasted content) since they're now expanded inline
    const nonTextParts = store.prompt.parts.filter((part) => part.type !== "text")

    const trimmedInput = inputText.trim()
    const slashToken = trimmedInput.startsWith("/") ? trimmedInput.split(/\s+/)[0] : undefined
    const localSlashHandlers: Record<string, () => void> = {
      "/status": () => command.trigger("arctic.status", "prompt"),
      "/usage": () => command.trigger("arctic.usage", "prompt"),
      "/stats": () => command.trigger("arctic.stats", "prompt"),
    }

    let handledLocally = false

    if (slashToken && localSlashHandlers[slashToken]) {
      localSlashHandlers[slashToken]()
      handledLocally = true
    } else if (store.mode === "shell") {
      sdk.client.session.shell({
        sessionID: currentSessionID,
        agent: local.agent.current().name,
        model: {
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
        },
        command: inputText,
      })
      setStore("mode", "normal")
    } else if (slashToken && sync.data.command.some((x) => x.name === slashToken.slice(1))) {
      let [commandText, ...args] = inputText.split(" ")
      sdk.client.session.command({
        sessionID: currentSessionID,
        command: commandText.slice(1),
        arguments: args.join(" "),
        agent: local.agent.current().name,
        model: `${selectedModel.providerID}/${selectedModel.modelID}`,
        messageID,
      })
    } else {
      sdk.client.session.prompt({
        sessionID: promptSessionID,
        ...selectedModel,
        messageID,
        agent: local.agent.current().name,
        model: selectedModel,
        thinkingLevel: local.thinking.supportsReasoning() ? local.thinking.current() : undefined,
        parts: [
          {
            id: Identifier.ascending("part"),
            type: "text",
            text: inputText,
          },
          ...nonTextParts.map((x) => ({
            id: Identifier.ascending("part"),
            ...x,
          })),
        ],
      })
    }
    if (!handledLocally) {
      history.append(store.prompt)
    }
    safe(() => input.extmarks.clear())
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID)
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID: currentSessionID,
        })
      }, 50)
    safeClearInput()
  }
  const exit = useExit()

  async function handleBenchmarkCommand(action: string) {
    const allowed = new Set(["start", "stop", "next", "prev", "apply", "undo"])
    if (!allowed.has(action)) {
      toast.show({
        variant: "warning",
        message: "Usage: /benchmark start|stop|next|prev|apply|undo",
        duration: 3000,
      })
      return
    }

    if (!props.sessionID && action !== "start") {
      toast.show({
        variant: "warning",
        message: "Open a session to use benchmark commands.",
        duration: 3000,
      })
      return
    }

    let baseSessionID = props.sessionID
    if (!baseSessionID) {
      const createResult = await sdk.client.session.create({})
      if (!createResult.data?.id) {
        toast.show({
          variant: "error",
          message: "Failed to create session.",
          duration: 3000,
        })
        return
      }
      baseSessionID = createResult.data.id
      route.navigate({ type: "session", sessionID: baseSessionID })
    }
    const current =
      sync.session.get(baseSessionID) ??
      (await sdk.client.session.get({ sessionID: baseSessionID }).then((x) => x.data))
    if (!current) {
      toast.show({
        variant: "error",
        message: "Session not found.",
        duration: 3000,
      })
      return
    }

    const parent =
      current.benchmark?.type === "parent"
        ? current
        : current.benchmark?.type === "child"
          ? (sync.session.get(current.benchmark.parentID) ??
            (await sdk.client.session.get({ sessionID: current.benchmark.parentID }).then((x) => x.data)))
          : undefined

    const children = parent?.benchmark?.type === "parent" ? parent.benchmark.children : []

    const benchmarkOptions = () => {
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
              disabled: modelID.includes("-nano"),
              footer: info.cost?.input === 0 ? "Free" : undefined,
            },
          ]
        })
      })
    }

    const selectModel = async (slot: number) => {
      return new Promise<{ providerID: string; modelID: string } | null>((resolve) => {
        let settled = false
        dialog.replace(
          () => (
            <DialogSelect
              title={`Select model (slot ${slot})`}
              options={benchmarkOptions()}
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

    switch (action) {
      case "start": {
        // Ensure dialog is clear before starting
        if (dialog.stack.length > 0) {
          dialog.clear()
        }
        if (parent?.benchmark?.type === "parent" && parent.benchmark.enabled) {
          toast.show({
            variant: "warning",
            message: "Benchmark mode is already enabled.",
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
          const model = await selectModel(i + 1)
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
          sessionID: current.benchmark?.type === "child" ? current.benchmark.parentID : current.id,
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
        const parentSession = result.data
        const firstChild = parentSession?.benchmark?.type === "parent" ? parentSession.benchmark.children[0] : undefined
        if (firstChild) {
          route.navigate({ type: "session", sessionID: firstChild.sessionID })
          setTimeout(() => {
            promptRef.current?.focus()
          }, 1)
        }
        if (parentSession?.benchmark?.type === "parent") {
          const promptQueue = new Map<string, string[]>()
          for (let i = 0; i < models.length; i++) {
            const key = `${models[i].providerID}/${models[i].modelID}`
            const prompt = prompts[i]
            if (!promptQueue.has(key)) promptQueue.set(key, [])
            promptQueue.get(key)!.push(prompt)
          }
          await Promise.all(
            parentSession.benchmark.children.map((child, index) => {
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
        return
      }
      case "stop": {
        if (!parent) {
          toast.show({
            variant: "warning",
            message: "Benchmark mode is not enabled.",
            duration: 3000,
          })
          return
        }
        await sdk.client.session.benchmark.stop({ sessionID: parent.id })
        return
      }
      case "next":
      case "prev": {
        if (!children.length) {
          toast.show({
            variant: "warning",
            message: "Benchmark mode is not enabled.",
            duration: 3000,
          })
          return
        }
        const direction = action === "next" ? 1 : -1
        const currentIndex = children.findIndex((child) => child.sessionID === current.id)
        const nextIndex =
          currentIndex === -1
            ? direction > 0
              ? 0
              : children.length - 1
            : (currentIndex + direction + children.length) % children.length
        const target = children[nextIndex]
        if (target) {
          route.navigate({ type: "session", sessionID: target.sessionID })
        }
        return
      }
      case "apply": {
        if (current.benchmark?.type !== "child") {
          toast.show({
            variant: "warning",
            message: "Switch to a benchmark child session to apply changes.",
            duration: 3000,
          })
          return
        }
        if (current.benchmark.error) {
          toast.show({
            variant: "error",
            message: `Benchmark session error: ${current.benchmark.error}`,
            duration: 5000,
          })
          return
        }
        let allowDirty = false
        const parentLatest =
          parent?.benchmark?.type === "parent"
            ? ((await sdk.client.session.get({ sessionID: parent.id }).then((x) => x.data)) ?? parent)
            : parent
        if (parentLatest?.benchmark?.type === "parent") {
          const applied = parentLatest.benchmark.appliedSessionID
          if (applied && applied !== current.id) {
            const confirmed = await DialogConfirm.show(
              dialog,
              "Another benchmark session is applied",
              "Undo it and apply this session?",
            )
            if (!confirmed) return
            if (!parent) return
            const undoResult = await sdk.client.session.benchmark.undo({ sessionID: parent.id })
            if (
              undoResult.error &&
              "name" in undoResult.error &&
              (undoResult.error as any).name === "BenchmarkWorkingTreeDirtyError"
            ) {
              const dirtyConfirmed = await DialogConfirm.show(dialog, "Working tree is dirty", "Apply anyway?")
              if (!dirtyConfirmed) return
              allowDirty = true
              await sdk.client.session.benchmark.undo({ sessionID: parent.id, allowDirty: true })
            }
          }
        }
        const result = await sdk.client.session.benchmark.apply({ sessionID: current.id, allowDirty })
        if (result.error && "name" in result.error && (result.error as any).name === "BenchmarkWorkingTreeDirtyError") {
          const confirmed = await DialogConfirm.show(dialog, "Working tree is dirty", "Apply anyway?")
          if (!confirmed) return
          await sdk.client.session.benchmark.apply({ sessionID: current.id, allowDirty: true })
          return
        }
        if (
          result.error &&
          "name" in result.error &&
          (result.error as any).name === "BenchmarkSnapshotUnavailableError"
        ) {
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
        return
      }
      case "undo": {
        if (!parent) {
          toast.show({
            variant: "warning",
            message: "Benchmark mode is not enabled.",
            duration: 3000,
          })
          return
        }
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
        return
      }
      default:
        return
    }
  }

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + virtualText.length

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function pasteImage(file: { filename?: string; content: string; mime: string }) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const count = store.prompt.parts.filter((x) => x.type === "file").length
    const virtualText = `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    return
  }

  const highlight = createMemo(() => {
    if (keybind.leader) return theme.border
    if (store.mode === "shell") return theme.primary
    return local.agent.color(local.agent.current().name)
  })

  const spinnerDef = createMemo(() => {
    const color = local.agent.color(local.agent.current().name)
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    return {
      frames,
      color,
    }
  })

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => (autocomplete = r)}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
      <box ref={(r) => (anchor = r)} width="100%" paddingLeft={1} paddingRight={1}>
        <box
          border={["top", "bottom"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            horizontal: "─",
            topLeft: " ",
            topRight: " ",
            bottomLeft: " ",
            bottomRight: " ",
          }}
          width="100%"
        >
          <box flexDirection="row" alignItems="flex-start" width="100%" gap={1}>
            <text attributes={TextAttributes.BOLD} fg={highlight()}>
              {store.mode === "shell" ? "!" : ">"}
            </text>
            <box flexGrow={1} flexShrink={1}>
              <textarea
                width="100%"
                backgroundColor="transparent"
                placeholder={inputPlaceholder()}
                textColor={keybind.leader ? theme.textMuted : theme.text}
                focusedTextColor={keybind.leader ? theme.textMuted : theme.text}
                minHeight={1}
                maxHeight={8}
                onContentChange={() => {
                  const value = input.plainText
                  setStore("prompt", "input", value)
                  autocomplete.onInput(value)
                  syncExtmarksWithPromptParts()
                }}
                keyBindings={textareaKeybindings()}
                onKeyDown={async (e) => {
                  if (props.disabled) {
                    e.preventDefault()
                    return
                  }

                  if (keybind.match("input_newline", e)) {
                    input.insertText("\n")
                    e.preventDefault()
                    return
                  }

                  // Handle Enter/Linefeed manually
                  if (e.name === "linefeed") {
                    // Warp sends \n for Shift+Enter
                    input.insertText("\n")
                    e.preventDefault()
                    return
                  }

                  if (e.name === "return") {
                    // Shift+Enter, Ctrl+Enter, or Alt+Enter = newline
                    if (e.shift || e.ctrl || e.meta) {
                      input.insertText("\n")
                      e.preventDefault()
                      return
                    }

                    if (autocomplete.visible) {
                      autocomplete.onKeyDown(e)
                      return
                    }

                    // Plain Enter = submit
                    submit()
                    e.preventDefault()
                    return
                  }

                  if (((e.ctrl && e.shift) || e.meta) && e.name === "c") {
                    // @ts-ignore
                    if (input.hasSelection?.()) {
                      return
                    }
                  }

                  if (keybind.match("input_clear", e) && store.prompt.input !== "") {
                    safeClearInput()
                    setStore("prompt", {
                      input: "",
                      parts: [],
                    })
                    setStore("extmarkToPartIndex", new Map())
                    return
                  }
                  if (keybind.match("app_exit", e)) {
                    if (store.prompt.input === "") {
                      // Let the app.tsx handler manage double-press exit when input is empty
                      return
                    } else {
                      // Clear prompt on first Ctrl+C when there's input
                      e.preventDefault()
                      safeClearInput()
                      setStore("prompt", {
                        input: "",
                        parts: [],
                      })
                      setStore("extmarkToPartIndex", new Map())
                      return
                    }
                  }
                  if (e.name === "!" && input.visualCursor.offset === 0) {
                    setStore("mode", "shell")
                    e.preventDefault()
                    return
                  }
                  if (store.mode === "shell") {
                    if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
                      setStore("mode", "normal")
                      e.preventDefault()
                      return
                    }
                  }
                  if (store.mode === "normal") autocomplete.onKeyDown(e)
                  if (!autocomplete.visible) {
                    if (
                      (keybind.match("history_previous", e) && input.cursorOffset === 0) ||
                      (keybind.match("history_next", e) && input.cursorOffset === input.plainText.length)
                    ) {
                      const direction = keybind.match("history_previous", e) ? -1 : 1
                      const item = history.move(direction, input.plainText)

                      if (item) {
                        input.setText(item.input)
                        setStore("prompt", item)
                        restoreExtmarksFromParts(item.parts)
                        e.preventDefault()
                        if (direction === -1) input.cursorOffset = 0
                        if (direction === 1) input.cursorOffset = input.plainText.length
                      }
                      return
                    }

                    if (keybind.match("history_previous", e) && input.visualCursor.visualRow === 0)
                      input.cursorOffset = 0
                    if (keybind.match("history_next", e) && input.visualCursor.visualRow === input.height - 1)
                      input.cursorOffset = input.plainText.length
                  }
                }}
                onPaste={async (event: PasteEvent) => {
                  if (props.disabled) {
                    event.preventDefault()
                    return
                  }

                  const normalizedText = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                  const pastedContent = normalizedText.trim()
                  if (!pastedContent) {
                    command.trigger("prompt.paste")
                    return
                  }

                  const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
                  const isUrl = /^(https?):\/\//.test(filepath)
                  if (!isUrl) {
                    try {
                      const file = Bun.file(filepath)
                      if (file.type === "image/svg+xml") {
                        event.preventDefault()
                        const content = await file.text().catch(() => {})
                        if (content) {
                          pasteText(content, `[SVG: ${file.name ?? "image"}]`)
                          return
                        }
                      }
                      if (file.type.startsWith("image/")) {
                        event.preventDefault()
                        const content = await file
                          .arrayBuffer()
                          .then((buffer) => Buffer.from(buffer).toString("base64"))
                          .catch(() => {})
                        if (content) {
                          await pasteImage({
                            filename: file.name,
                            mime: file.type,
                            content,
                          })
                          return
                        }
                      }
                    } catch {}
                  }

                  const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
                  if (
                    (lineCount >= 3 || pastedContent.length > 150) &&
                    !sync.data.config.experimental?.disable_paste_summary
                  ) {
                    event.preventDefault()
                    pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
                    return
                  }
                }}
                ref={(r: TextareaRenderable) => {
                  input = r
                  setTimeout(() => {
                    input.cursorColor = theme.text
                  }, 0)
                }}
                onMouseDown={handleTextareaMouseDown}
                focusedBackgroundColor="transparent"
                cursorColor={theme.text}
                syntaxStyle={syntax()}
              />
            </box>
          </box>
        </box>
        <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
          <text fg={highlight()} onMouseUp={() => dialog.replace(() => <DialogAgent />)}>
            {store.mode === "shell" ? "Shell" : Locale.titlecase(local.agent.current().name)}
          </text>
          <Show when={store.mode === "normal"}>
            <text fg={theme.textMuted}>·</text>
            <box flexDirection="row" gap={1} onMouseUp={() => dialog.replace(() => <DialogModel />)}>
              <text flexShrink={0} fg={keybind.leader ? theme.textMuted : theme.text}>
                {displayModel().model}
              </text>
              {(() => {
                const model = local.model.current()
                const supportsReasoning = local.thinking.supportsReasoning()
                const isGitHubCopilot = model?.providerID === "github-copilot" || model?.providerID === "github-copilot-enterprise"
                const multiplier = isGitHubCopilot && model ? Pricing.getCopilotMultiplier(model.modelID, "paid") : null
                
                const showBadge = supportsReasoning || (isGitHubCopilot && multiplier !== null)
                if (!showBadge) return null
                
                const parts: string[] = []
                if (supportsReasoning) {
                  parts.push(local.thinking.current())
                }
                if (isGitHubCopilot && multiplier !== null) {
                  parts.push(`x${multiplier}`)
                }
                
                return (
                  <text
                    fg={
                      supportsReasoning
                        ? { low: theme.textMuted, medium: theme.warning, high: theme.primary }[local.thinking.current()] ??
                          theme.textMuted
                        : theme.textMuted
                    }
                    onMouseUp={(e) => {
                      e.stopPropagation()
                      supportsReasoning && local.thinking.cycle()
                    }}
                  >
                    ({parts.join(", ")})
                  </text>
                )
              })()}
              <text fg={theme.textMuted}>{displayModel().provider}</text>
            </box>
            <Show when={usageLimits() !== undefined}>
              <text fg={theme.textMuted}>·</text>
              {(() => {
                const limits = usageLimits()!
                const model = local.model.current()
                const isMinimax = model?.providerID === "minimax" || model?.providerID === "minimax-coding-plan"
                const remaining = limits.percent !== undefined ? Math.max(0, 100 - limits.percent) : undefined
                const percentValue = isMinimax ? (limits.percent ?? undefined) : remaining
                const color = percentValue !== undefined && percentValue <= 15 ? theme.error : theme.textMuted
                const label = (() => {
                  if (percentValue !== undefined) {
                    return `${percentValue.toFixed(0)}% left${limits.timeLeft ? ` (${limits.timeLeft})` : ""}`
                  }
                  return limits.timeLeft ? `resets in ${limits.timeLeft}` : ""
                })()
                return (
                  <text fg={color} onMouseUp={() => command.trigger("arctic.usage", "prompt")}>
                    {label}
                  </text>
                )
              })()}
            </Show>
            <Show when={sessionCost() !== undefined}>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.textMuted}>session: ${sessionCost()! < 0.01 ? "0.00" : sessionCost()!.toFixed(2)}</text>
            </Show>
            <Show when={dailyCost() !== undefined}>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.textMuted}>today: ${dailyCost()! < 0.01 ? "0.00" : dailyCost()!.toFixed(2)}</text>
            </Show>
          </Show>
        </box>
        <Show when={props.exitConfirmation}>
          <text fg={theme.textMuted} paddingLeft={1}>
            Press ctrl+c again to exit
          </text>
        </Show>
        <Show when={status().type !== "idle"}>
          <box flexDirection="row" gap={1}>
            <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
            <text fg={theme.textMuted}>
              Working...{" "}
              <span style={{ fg: store.interrupt > 0 ? theme.primary : theme.textMuted }}>
                ({store.interrupt > 0 ? "esc again to interrupt" : "esc to interrupt"})
              </span>
            </text>
            {(() => {
              const retry = createMemo(() => {
                const s = status()
                if (s.type !== "retry") return
                return s
              })
              const message = createMemo(() => {
                const r = retry()
                if (!r) return
                if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
                  return "gemini is way too hot right now"
                if (r.message.length > 80) return r.message.slice(0, 80) + "..."
                return r.message
              })
              const isTruncated = createMemo(() => {
                const r = retry()
                if (!r) return false
                return r.message.length > 120
              })
              const [seconds, setSeconds] = createSignal(0)
              onMount(() => {
                const timer = setInterval(() => {
                  const next = retry()?.next
                  if (next) setSeconds(Math.round((next - Date.now()) / 1000))
                }, 1000)

                onCleanup(() => {
                  clearInterval(timer)
                })
              })
              const handleMessageClick = () => {
                const r = retry()
                if (!r) return
                if (isTruncated()) {
                  DialogAlert.show(dialog, "Retry Error", r.message)
                }
              }

              const retryText = () => {
                const r = retry()
                if (!r) return ""
                const baseMessage = message()
                const truncatedHint = isTruncated() ? " (click to expand)" : ""
                const retryInfo = ` [retrying ${seconds() > 0 ? `in ${seconds()}s ` : ""}attempt #${r.attempt}]`
                return baseMessage + truncatedHint + retryInfo
              }

              return (
                <Show when={retry()}>
                  <box onMouseUp={handleMessageClick}>
                    <text fg={theme.error}>{retryText()}</text>
                  </box>
                </Show>
              )
            })()}
          </box>
        </Show>
      </box>
    </>
  )
}
