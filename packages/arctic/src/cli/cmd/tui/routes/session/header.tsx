import { type Accessor, createMemo, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { SplitBorder, EmptyBorder } from "@tui/component/border"
import type { AssistantMessage, Session } from "@arctic-ai/sdk/v2"
import { useDirectory } from "../../context/directory"
import { useKeybind } from "../../context/keybind"
import { Time } from "@/util/time"

const Title = (props: { session: Accessor<Session> }) => {
  const { theme } = useTheme()
  return (
    <text fg={theme.text}>
      <span style={{ bold: true }}>#</span> <span style={{ bold: true }}>{props.session().title}</span>
    </text>
  )
}

const ContextInfo = (props: {
  context: Accessor<string | undefined>
  cost: Accessor<string>
  workTime: Accessor<string | undefined>
  isWorking: Accessor<boolean>
}) => {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <Show when={props.context()}>
        <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
          {props.context()} ({props.cost()})
        </text>
      </Show>
      <Show when={props.workTime()}>
        <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
          • {props.workTime()}{props.isWorking() ? " ⏳" : ""}
        </text>
      </Show>
    </box>
  )
}

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const isBenchmarkChild = createMemo(() => session()?.benchmark?.type === "child")

  // Timer tick to update work time display in real-time
  const [tick, setTick] = createSignal(0)
  const interval = setInterval(() => setTick((t) => t + 1), 1000)
  onCleanup(() => clearInterval(interval))

  const cost = createMemo(() => {
    const total = pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    )
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    let result = total.toLocaleString()
    if (model?.limit.context) {
      result += "  " + Math.round((total / model.limit.context) * 100) + "%"
    }
    return result
  })

  const workTime = createMemo(() => {
    // Force recalculation every second
    tick()

    const timeData = sync.data.session_work_time[route.sessionID]
    if (!timeData) return undefined

    let totalMs = timeData.totalMs

    // If currently working, add the time since start
    if (timeData.currentStart) {
      totalMs += Date.now() - timeData.currentStart
    }

    if (totalMs === 0) return undefined
    return Time.formatDuration(totalMs)
  })

  const isWorking = createMemo(() => {
    const timeData = sync.data.session_work_time[route.sessionID]
    return !!timeData?.currentStart
  })

  const { theme } = useTheme()
  const keybind = useKeybind()

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={theme.border}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
      >
        <Switch>
          <Match when={session()?.parentID}>
            <box flexDirection="row" gap={2}>
              <text fg={theme.text}>
                <b>{isBenchmarkChild() ? "Benchmark session" : "Subagent session"}</b>
              </text>
              <text fg={theme.text}>
                Prev{" "}
                <span style={{ fg: theme.textMuted }}>
                  {keybind.print(isBenchmarkChild() ? "benchmark_prev" : "session_child_cycle_reverse")}
                </span>
              </text>
              <text fg={theme.text}>
                Next{" "}
                <span style={{ fg: theme.textMuted }}>
                  {keybind.print(isBenchmarkChild() ? "benchmark_next" : "session_child_cycle")}
                </span>
              </text>
              <box flexGrow={1} flexShrink={1} />
              <ContextInfo context={context} cost={cost} workTime={workTime} isWorking={isWorking} />
            </box>
          </Match>
          <Match when={true}>
            <box flexDirection="row" justifyContent="space-between" gap={1}>
              <Title session={session} />
              <ContextInfo context={context} cost={cost} workTime={workTime} isWorking={isWorking} />
            </box>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
