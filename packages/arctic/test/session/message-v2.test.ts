import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { MessageV2 } from "../../src/session/message-v2"

const sessionID = "ses_test"

function user(id: string, text: string): MessageV2.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 0 },
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
    },
    parts: [
      {
        id: "p_" + id,
        sessionID,
        messageID: id,
        type: "text",
        text,
      },
    ],
  }
}

function assistant(id: string, parentID: string, text: string): MessageV2.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      parentID,
      modelID: "claude-sonnet-4-20250514",
      providerID: "anthropic",
      mode: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0 },
    },
    parts: [
      {
        id: "p_" + id,
        sessionID,
        messageID: id,
        type: "text",
        text,
      },
    ],
  }
}

function userText(msg: ModelMessage): string {
  if (msg.role !== "user" || !Array.isArray(msg.content)) return ""
  return msg.content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
}

describe("MessageV2.toModelMessage", () => {
  test("preserves alternating user/assistant roles", () => {
    const result = MessageV2.toModelMessage([
      user("msg_u1", "Hello"),
      assistant("msg_a1", "msg_u1", "Hi there"),
      user("msg_u2", "How are you?"),
    ])

    expect(result.map((m) => m.role)).toEqual(["user", "assistant", "user"])
  })

  test("merges consecutive user messages (errored assistant removed)", () => {
    // simulates the long-conversation bug: an errored assistant is filtered out
    // by the caller, leaving two user messages back to back
    const result = MessageV2.toModelMessage([user("msg_u1", "Hello"), user("msg_u2", "How are you?")])

    expect(result).toHaveLength(1)
    expect(result[0].role).toBe("user")
    expect(userText(result[0])).toBe("HelloHow are you?")
  })

  test("merges three consecutive user messages into one", () => {
    const result = MessageV2.toModelMessage([user("msg_u1", "one"), user("msg_u2", "two"), user("msg_u3", "three")])

    expect(result).toHaveLength(1)
    expect(result[0].role).toBe("user")
    expect(userText(result[0])).toBe("onetwothree")
  })

  test("merges consecutive user messages in the middle of a conversation", () => {
    const result = MessageV2.toModelMessage([
      user("msg_u1", "first"),
      assistant("msg_a1", "msg_u1", "reply one"),
      // msg_u2 had an errored assistant that was filtered out
      user("msg_u2", "second"),
      user("msg_u3", "third"),
    ])

    expect(result.map((m) => m.role)).toEqual(["user", "assistant", "user"])
    expect(userText(result[2])).toBe("secondthird")
  })
})
