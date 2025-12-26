import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { ProviderUsage } from "@/provider/usage"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Log } from "@/util/log"
import { formatUsageSummary } from "./usage-format"

export namespace SessionUsage {
  const log = Log.create({ service: "session.usage" })

  export type RunInput = {
    sessionID: string
    agent: string
    model: {
      providerID: string
      modelID: string
    }
  }

  export async function run(input: RunInput): Promise<MessageV2.WithParts> {
    const parentID = (await createSyntheticUserMessage(input)).info.id
    const now = Date.now()

    const loaderMessage = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID,
      sessionID: input.sessionID,
      mode: input.agent,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      modelID: input.model.modelID,
      providerID: input.model.providerID,
      time: {
        created: now,
        completed: now,
      },
      finish: "usage",
    })) as MessageV2.Assistant

    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: loaderMessage.id,
      sessionID: input.sessionID,
      type: "text",
      text: "Fetching usage...",
      synthetic: true,
      time: {
        start: now,
        end: now,
      },
    })

    let summaryText = ""
    let providerCount = 0
    try {
      const usageRecords = await ProviderUsage.fetch(undefined, { sessionID: input.sessionID })
      providerCount = usageRecords.length
      summaryText = formatUsageSummary(usageRecords)
      log.info("usage summary created", {
        sessionID: input.sessionID,
        providerCount,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      summaryText = `Failed to fetch usage: ${message}`
      log.error("usage summary failed", {
        sessionID: input.sessionID,
        error: message,
      })
    }

    await Session.removeMessage({
      sessionID: input.sessionID,
      messageID: loaderMessage.id,
    })

    const completedAt = Date.now()
    const assistant = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID,
      sessionID: input.sessionID,
      mode: input.agent,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      modelID: input.model.modelID,
      providerID: input.model.providerID,
      time: {
        created: completedAt,
        completed: completedAt,
      },
      finish: "usage",
    })) as MessageV2.Assistant

    const part = await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: assistant.id,
      sessionID: input.sessionID,
      type: "text",
      text: summaryText,
      synthetic: true,
      time: {
        start: completedAt,
        end: completedAt,
      },
    })

    return {
      info: assistant,
      parts: [part],
    }
  }

  async function createSyntheticUserMessage(input: RunInput) {
    const userMsg = await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "user",
      sessionID: input.sessionID,
      agent: input.agent,
      model: {
        providerID: input.model.providerID,
        modelID: input.model.modelID,
      },
      time: {
        created: Date.now(),
      },
    })
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: userMsg.sessionID,
      type: "text",
      text: "/usage",
      synthetic: true,
      time: {
        start: Date.now(),
        end: Date.now(),
      },
    })
    return { info: userMsg, parts: [] as MessageV2.Part[] }
  }
}
