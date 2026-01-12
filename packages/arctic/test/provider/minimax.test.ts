import { expect, test } from "bun:test"
import path from "path"
import { Env } from "../../src/env"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

test("minimax-coding-plan provider loaded from env variable", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "arctic.json"),
        JSON.stringify({
          $schema: "https://usearctic.sh/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("MINIMAX_CODING_PLAN_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["minimax-coding-plan"]).toBeDefined()
      expect(providers["minimax-coding-plan"].name).toBe("MiniMax Coding Plan")
      expect(providers["minimax-coding-plan"].options.baseURL).toBe("https://api.minimax.io/anthropic/v1")
    },
  })
})

test("minimax-coding-plan provider loaded from MINIMAX_API_KEY fallback", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "arctic.json"),
        JSON.stringify({
          $schema: "https://usearctic.sh/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("MINIMAX_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["minimax-coding-plan"]).toBeDefined()
      expect(providers["minimax-coding-plan"].name).toBe("MiniMax Coding Plan")
    },
  })
})

test("minimax-coding-plan model MiniMax-M2.1 exists", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "arctic.json"),
        JSON.stringify({
          $schema: "https://usearctic.sh/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("MINIMAX_CODING_PLAN_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["minimax-coding-plan"].models["MiniMax-M2.1"]).toBeDefined()
      const model = providers["minimax-coding-plan"].models["MiniMax-M2.1"]
      expect(model.name).toBe("MiniMax-M2.1 (Coding Plan)")
      expect(model.providerID).toBe("minimax-coding-plan")
      expect(model.api.npm).toBe("@ai-sdk/anthropic")
      expect(model.capabilities.toolcall).toBe(true)
      expect(model.capabilities.temperature).toBe(true)
    },
  })
})

test("minimax-coding-plan provider can be configured via config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "arctic.json"),
        JSON.stringify({
          $schema: "https://usearctic.sh/config.json",
          provider: {
            "minimax-coding-plan": {
              options: {
                apiKey: "config-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["minimax-coding-plan"]).toBeDefined()
      expect(providers["minimax-coding-plan"].models["MiniMax-M2.1"]).toBeDefined()
    },
  })
})

test("minimax-coding-plan getModel returns model", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "arctic.json"),
        JSON.stringify({
          $schema: "https://usearctic.sh/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("MINIMAX_CODING_PLAN_API_KEY", "test-api-key")
    },
    fn: async () => {
      const model = await Provider.getModel("minimax-coding-plan", "MiniMax-M2.1")
      expect(model).toBeDefined()
      expect(model.providerID).toBe("minimax-coding-plan")
      expect(model.id).toBe("MiniMax-M2.1")
    },
  })
})
