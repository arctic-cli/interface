import z from "zod"
import { Identifier } from "../id/id"

export namespace BenchmarkSchema {
  export const Model = z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .meta({
      ref: "BenchmarkModel",
    })
  export type Model = z.infer<typeof Model>

  export const Child = z
    .object({
      sessionID: Identifier.schema("session"),
      model: Model,
      worktree: z.string().optional(),
      lastSnapshot: z.string().optional(),
      error: z.string().optional(),
    })
    .meta({
      ref: "BenchmarkChildInfo",
    })
  export type Child = z.infer<typeof Child>

  export const Parent = z
    .object({
      type: z.literal("parent"),
      enabled: z.boolean(),
      createdAt: z.number(),
      baseSnapshot: z.string().optional(),
      baseWorktree: z.string().optional(),
      children: Child.array(),
      appliedSessionID: Identifier.schema("session").optional(),
      checkpointSnapshot: z.string().optional(),
    })
    .meta({
      ref: "BenchmarkParentInfo",
    })
  export type Parent = z.infer<typeof Parent>

  export const ChildSession = z
    .object({
      type: z.literal("child"),
      parentID: Identifier.schema("session"),
      model: Model,
      worktree: z.string().optional(),
      lastSnapshot: z.string().optional(),
      error: z.string().optional(),
    })
    .meta({
      ref: "BenchmarkChildSessionInfo",
    })
  export type ChildSession = z.infer<typeof ChildSession>

  export const Info = z.discriminatedUnion("type", [Parent, ChildSession]).meta({
    ref: "BenchmarkInfo",
  })
  export type Info = z.infer<typeof Info>
}
