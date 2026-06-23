import type { Snapshot } from "@/snapshot"
import { Log } from "@/util/log"
import type { Path } from "@arctic-cli/sdk"
import type {
  Agent,
  Command,
  Config,
  FormatterStatus,
  LspStatus,
  McpStatus,
  Message,
  Part,
  Permission,
  Provider,
  ProviderAuthMethod,
  ProviderListResponse,
  Pty,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from "@arctic-cli/sdk/v2"
import { Binary } from "@arctic-cli/util/binary"
import { useSDK } from "@tui/context/sdk"
import { batch, onMount } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useExit } from "./exit"
import { createSimpleContext } from "./helper"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: Permission[]
      }
      permission_bypass_enabled: boolean
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
      }
      session_work_time: {
        [sessionID: string]: {
          currentStart?: number
          totalMs: number
        }
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
      path: Path
      pty: Pty[]
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      permission_bypass_enabled: false,
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      session_work_time: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      formatter: [],
      vcs: undefined,
      path: { state: "", config: "", worktree: "", directory: "" },
      pty: [],
    })

    const sdk = useSDK()

    sdk.event.listen((e) => {
      const event = e.details
      switch (event.type) {
        case "permission.updated": {
          const permissions = store.permission[event.properties.sessionID]
          if (!permissions) {
            setStore("permission", event.properties.sessionID, [event.properties])
            break
          }
          const match = Binary.search(permissions, event.properties.id, (p) => p.id)
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              if (match.found) {
                draft[match.index] = event.properties
                return
              }
              draft.push(event.properties)
            }),
          )
          break
        }

        case "permission.replied": {
          const permissions = store.permission[event.properties.sessionID]
          const match = Binary.search(permissions, event.properties.permissionID, (p) => p.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.status": {
          const sessionID = event.properties.sessionID
          const status = event.properties.status

          setStore("session_status", sessionID, status)

          // track work time
          const currentTime = store.session_work_time[sessionID]

          if (status.type === "busy") {
            // start timer
            if (!currentTime?.currentStart) {
              setStore("session_work_time", sessionID, {
                currentStart: Date.now(),
                totalMs: currentTime?.totalMs ?? 0,
              })
            }
          }
          if (status.type === "idle") {
            // stop timer and accumulate
            if (currentTime?.currentStart) {
              const elapsed = Date.now() - currentTime.currentStart
              setStore("session_work_time", sessionID, {
                currentStart: undefined,
                totalMs: currentTime.totalMs + elapsed,
              })
            }
          }
          break
        }

        case "message.updated": {
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
              if (draft.length > 100) draft.shift()
            }),
          )
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.removed": {
          const parts = store.part[event.properties.messageID]
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          break
        }

        case "lsp.updated": {
          sdk.client.lsp.status().then((x) => setStore("lsp", x.data!))
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }

        case "pty.created": {
          setStore(
            "pty",
            produce((draft) => {
              draft.push(event.properties.info)
            }),
          )
          break
        }

        case "pty.updated": {
          const index = store.pty.findIndex((p) => p.id === event.properties.info.id)
          if (index !== -1) {
            setStore("pty", index, reconcile(event.properties.info))
          }
          break
        }

        case "pty.exited": {
          const index = store.pty.findIndex((p) => p.id === event.properties.id)
          if (index !== -1) {
            setStore("pty", index, "status", "exited")
          }
          break
        }

        case "pty.deleted": {
          setStore(
            "pty",
            produce((draft) => {
              const index = draft.findIndex((p) => p.id === event.properties.id)
              if (index !== -1) draft.splice(index, 1)
            }),
          )
          break
        }

        case "server.connected": {
          // refetch session status on reconnect to ensure TUI state is in sync
          // this handles cases where the connection dropped and we missed status events
          sdk.client.session.status().then((x) => {
            if (!x.data) return
            // compare with current state and only update what's different
            const serverStatuses = x.data
            const currentStatuses = store.session_status

            // for sessions that server says are busy/retry but we think are idle (or missing),
            // we need to update our state
            for (const [sessionID, status] of Object.entries(serverStatuses)) {
              const current = currentStatuses[sessionID]
              if (!current || current.type !== status.type) {
                setStore("session_status", sessionID, status)
                // also update work time if status changed to busy
                if (status.type === "busy") {
                  const currentTime = store.session_work_time[sessionID]
                  if (!currentTime?.currentStart) {
                    setStore("session_work_time", sessionID, {
                      currentStart: Date.now(),
                      totalMs: currentTime?.totalMs ?? 0,
                    })
                  }
                }
              }
            }

            // for sessions we think are busy but server says are idle (not in list),
            // set them to idle
            for (const sessionID of Object.keys(currentStatuses)) {
              if (currentStatuses[sessionID].type !== "idle" && !serverStatuses[sessionID]) {
                setStore("session_status", sessionID, { type: "idle" })
                // clear work time timer
                const currentTime = store.session_work_time[sessionID]
                if (currentTime?.currentStart) {
                  const elapsed = Date.now() - currentTime.currentStart
                  setStore("session_work_time", sessionID, {
                    currentStart: undefined,
                    totalMs: currentTime.totalMs + elapsed,
                  })
                }
              }
            }
          })

          // re-sync messages for sessions already in the store
          // this recovers any message.part.updated events missed during disconnection,
          // which is the primary cause of user messages appearing empty/hidden
          for (const sessionID of Object.keys(store.message)) {
            sdk.client.session
              .messages({ sessionID, limit: 100 })
              .then((res) => {
                if (!res.data) return
                setStore(
                  produce((draft) => {
                    draft.message[sessionID] = res.data!.map((m) => m.info)
                    for (const m of res.data!) {
                      draft.part[m.info.id] = m.parts
                    }
                  }),
                )
              })
              .catch(() => {})
          }
          break
        }
      }

      // handle permission bypass update
      if (event.type === "permission.bypass.updated") {
        setStore("permission_bypass_enabled", event.properties.enabled)
      }
    })

    const exit = useExit()

    async function bootstrap() {
      // blocking
      await Promise.all([
        sdk.client.config.providers({}, { throwOnError: true }).then((x) => {
          batch(() => {
            setStore("provider", x.data!.providers)
            setStore("provider_default", x.data!.default)
          })
        }),
        sdk.client.provider.list({}, { throwOnError: true }).then((x) => {
          batch(() => {
            setStore("provider_next", x.data!)
          })
        }),
        sdk.client.app.agents({}, { throwOnError: true }).then((x) => setStore("agent", x.data ?? [])),
        sdk.client.config.get({}, { throwOnError: true }).then((x) => setStore("config", x.data!)),
      ])
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          Promise.all([
            sdk.client.session.list().then((x) =>
              setStore(
                "session",
                (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)),
              ),
            ),
            sdk.client.command.list().then((x) => setStore("command", x.data ?? [])),
            sdk.client.lsp.status().then((x) => setStore("lsp", x.data!)),
            sdk.client.mcp.status().then((x) => setStore("mcp", x.data!)),
            sdk.client.formatter.status().then((x) => setStore("formatter", x.data!)),
            sdk.client.session.status().then((x) => setStore("session_status", x.data!)),
            sdk.client.provider.auth().then((x) => setStore("provider_auth", x.data ?? {})),
            sdk.client.vcs.get().then((x) => setStore("vcs", x.data)),
            sdk.client.path.get().then((x) => setStore("path", x.data!)),
            sdk.client.pty.list().then((x) => setStore("pty", x.data ?? [])),
            // fetch permission bypass status
            sdk.client.permission.bypass
              .get()
              .then((x) => setStore("permission_bypass_enabled", x.data?.enabled ?? false))
              .catch(() => {}),
            // Initialize OpenRouter pricing cache in background (with timeout to avoid hanging)
            // TODO: Temporarily disabled due to Bun crash
            // Promise.race([
            //   Pricing.initOpenRouterPricing(),
            //   new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000)),
            // ]).catch((e) => {
            //   Log.Default.warn("Failed to initialize OpenRouter pricing", { error: e instanceof Error ? e.message : String(e) })
            // }),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          await exit(e)
        })
    }

    onMount(() => {
      bootstrap()
    })

    const fullSyncedSessions = new Set<string>()
    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const [session, messages, todo, diff] = await Promise.all([
            sdk.client.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.session.messages({ sessionID, limit: 100 }),
            sdk.client.session.todo({ sessionID }),
            sdk.client.session.diff({ sessionID }),
          ])
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session[match.index] = session.data!
              if (!match.found) draft.session.splice(match.index, 0, session.data!)
              draft.todo[sessionID] = todo.data ?? []
              draft.message[sessionID] = (messages.data ?? []).map((x) => x.info)
              for (const message of messages.data ?? []) {
                draft.part[message.info.id] = message.parts
              }
              draft.session_diff[sessionID] = diff.data ?? []
            }),
          )
          fullSyncedSessions.add(sessionID)
        },
      },
      bootstrap,
    }
    return result
  },
})
