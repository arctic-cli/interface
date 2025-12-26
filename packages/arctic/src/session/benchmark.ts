import { BenchmarkSchema } from "./benchmark-schema"
import z from "zod"
import { Session } from "."
import { Provider } from "../provider/provider"
import { Snapshot } from "../snapshot"
import { Lock } from "../util/lock"
import { NamedError } from "@arctic-ai/util/error"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import path from "path"
import fs from "fs/promises"
import { $ } from "bun"
import { Global } from "../global"

export namespace SessionBenchmark {
  const LOCK_KEY = "benchmark.worktree"

  export const DuplicateModelsError = NamedError.create(
    "BenchmarkDuplicateModelsError",
    z.object({
      models: z.array(z.string()),
    }),
  )

  export const SnapshotUnavailableError = NamedError.create(
    "BenchmarkSnapshotUnavailableError",
    z.object({
      message: z.string(),
    }),
  )

  export const WorkingTreeDirtyError = NamedError.create(
    "BenchmarkWorkingTreeDirtyError",
    z.object({
      message: z.string(),
    }),
  )

  export function isParent(session: Session.Info | undefined): session is Session.Info & {
    benchmark: BenchmarkSchema.Parent
  } {
    return session?.benchmark?.type === "parent"
  }

  export function isChild(session: Session.Info | undefined): session is Session.Info & {
    benchmark: BenchmarkSchema.ChildSession
  } {
    return session?.benchmark?.type === "child"
  }

  export async function resolveParent(sessionID: string) {
    const session = await Session.get(sessionID)
    if (isParent(session)) return session
    if (isChild(session)) return Session.get(session.benchmark.parentID)
    return undefined
  }

  export async function resolveChild(sessionID: string, targetSessionID?: string) {
    const session = await Session.get(sessionID)
    if (isChild(session)) return session
    if (isParent(session) && targetSessionID) {
      const child = await Session.get(targetSessionID)
      if (isChild(child) && child.benchmark.parentID === session.id) return child
    }
    return undefined
  }

  export async function start(input: {
    sessionID: string
    count?: number
    models?: BenchmarkSchema.Model[]
    allowDuplicates?: boolean
  }) {
    let parent = await Session.get(input.sessionID)
    if (isChild(parent)) {
      parent = await Session.get(parent.benchmark.parentID)
    }
    if (isParent(parent)) {
      await stop({ sessionID: parent.id })
    }

    const models = await resolveModels({
      sessionID: parent.id,
      models: input.models,
      count: input.count,
    })

    if (!input.allowDuplicates && hasDuplicates(models)) {
      throw new DuplicateModelsError({
        models: models.map((item) => `${item.providerID}/${item.modelID}`),
      })
    }

    const baseSnapshot = await Snapshot.track()
    if (!baseSnapshot) {
      throw new SnapshotUnavailableError({
        message: "Benchmark mode requires snapshots (git) to be enabled.",
      })
    }

    // Create worktree root directory
    const worktreeRoot = path.join(Global.Path.data, "benchmark", parent.id)
    await fs.mkdir(worktreeRoot, { recursive: true })

    // Create base worktree (+1 worktree for initial codebase)
    const baseWorktree = path.join(worktreeRoot, "base")
    await fs.mkdir(baseWorktree, { recursive: true })
    await Snapshot.restoreTo(baseSnapshot, baseWorktree, { cleanUntracked: true })

    const children: BenchmarkSchema.Child[] = []
    for (const model of models) {
      const title = `Benchmark - ${model.providerID}/${model.modelID} - ${new Date().toISOString()}`
      const childID = Identifier.descending("session")
      const childWorktree = path.join(worktreeRoot, childID)
      const child = await Session.createNext({
        id: childID,
        parentID: parent.id,
        directory: childWorktree,
        title,
      })
      await fs.mkdir(childWorktree, { recursive: true })
      await Snapshot.restoreTo(baseSnapshot, childWorktree, { cleanUntracked: true })
      await Session.update(child.id, (draft) => {
        draft.benchmark = {
          type: "child",
          parentID: parent.id,
          model,
          worktree: childWorktree,
        }
      })
      children.push({
        sessionID: child.id,
        model,
        worktree: childWorktree,
      })
    }

    const updated = await Session.update(parent.id, (draft) => {
      draft.benchmark = {
        type: "parent",
        enabled: true,
        createdAt: Date.now(),
        baseSnapshot,
        baseWorktree,
        children,
      }
    })
    return updated
  }

  export async function stop(input: { sessionID: string }) {
    const parent = await resolveParent(input.sessionID)
    if (!parent || !isParent(parent)) return parent ?? (await Session.get(input.sessionID))

    const children = parent.benchmark.children
    await Promise.all(
      children.map((child) =>
        Session.update(child.sessionID, (draft) => {
          draft.benchmark = undefined
        }),
      ),
    )
    const worktreeRoot = path.join(Global.Path.data, "benchmark", parent.id)
    await fs.rm(worktreeRoot, { recursive: true, force: true }).catch(() => {})

    return Session.update(parent.id, (draft) => {
      draft.benchmark = undefined
    })
  }

  export async function ensureBaseSnapshot(parent: Session.Info) {
    if (!isParent(parent)) return undefined
    if (parent.benchmark.baseSnapshot) return parent.benchmark.baseSnapshot
    const snapshot = await Snapshot.track()
    if (!snapshot) {
      throw new SnapshotUnavailableError({
        message: "Benchmark mode requires snapshots (git) to be enabled.",
      })
    }
    await Session.update(parent.id, (draft) => {
      if (draft.benchmark?.type === "parent") {
        draft.benchmark.baseSnapshot = snapshot
      }
    })
    return snapshot
  }

  export async function updateChildSnapshot(sessionID: string, snapshot?: string, error?: string) {
    await Session.update(sessionID, (draft) => {
      if (draft.benchmark?.type === "child") {
        if (snapshot) draft.benchmark.lastSnapshot = snapshot
        if (error) draft.benchmark.error = error
        if (!error) draft.benchmark.error = undefined
      }
    })
  }

  export async function latestSnapshot(sessionID: string) {
    const messages = await Session.messages({ sessionID })
    let snapshot: string | undefined
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type === "step-finish" && part.snapshot) {
          snapshot = part.snapshot
        }
      }
    }
    return snapshot
  }

  export async function withWorktreeLock<T>(fn: () => Promise<T>) {
    using _ = await Lock.write(LOCK_KEY)
    return fn()
  }

  /**
   * Apply a child benchmark session's changes to the workspace.
   * Strategy (checkpoint/restore):
   * 1. Create checkpoint of current workspace state
   * 2. Restore AI's exact file states to workspace
   */
  export async function apply(input: { sessionID: string; targetSessionID?: string; allowDirty?: boolean }) {
    return withWorktreeLock(async () => {
      const child = await resolveChild(input.sessionID, input.targetSessionID)
      if (!child) return Session.get(input.sessionID)
      const parent = await Session.get(child.benchmark.parentID)
      if (!isParent(parent) || !parent.benchmark.enabled) return parent

      const dirty = await isDirty()
      if (!input.allowDirty && dirty) {
        throw new WorkingTreeDirtyError({ message: "Working tree has uncommitted changes." })
      }

      const childSnapshot = child.benchmark.lastSnapshot ?? (await latestSnapshot(child.id))
      if (!childSnapshot) {
        throw new SnapshotUnavailableError({
          message: "No snapshot available for this benchmark session.",
        })
      }

      // Step 1: Create checkpoint of current workspace state
      const checkpoint = await Snapshot.track()
      if (!checkpoint) {
        throw new SnapshotUnavailableError({
          message: "Benchmark mode requires snapshots (git) to be enabled.",
        })
      }

      const currentAppliedID = parent.benchmark.appliedSessionID

      // If we are currently in a child session, save its state before switching
      if (currentAppliedID) {
        const currentChild = await Session.get(currentAppliedID)
        if (isChild(currentChild) && currentChild.benchmark.parentID === parent.id) {
          await updateChildSnapshot(currentChild.id, checkpoint)
          const currentWorktree = await ensureChildWorktree(parent, currentChild)
          await Snapshot.restoreTo(checkpoint, currentWorktree, { cleanUntracked: true })
        }
      }

      // Step 2: Restore AI's exact file states to workspace
      await Snapshot.restoreTo(childSnapshot, Instance.worktree, { cleanUntracked: true })

      return Session.update(parent.id, (draft) => {
        if (draft.benchmark?.type === "parent") {
          draft.benchmark.appliedSessionID = child.id
          // Only update checkpointSnapshot if we are switching from the parent session
          if (!currentAppliedID) {
            draft.benchmark.checkpointSnapshot = checkpoint
          }
        }
      })
    })
  }

  /**
   * Undo applied benchmark changes.
   * Strategy: Simply restore the checkpoint from before the apply.
   * Manual edits made AFTER apply are discarded.
   * Manual edits made BEFORE apply are preserved (they're in the checkpoint).
   */
  export async function undo(input: { sessionID: string; allowDirty?: boolean }) {
    return withWorktreeLock(async () => {
      const parent = await resolveParent(input.sessionID)
      if (!parent || !isParent(parent)) return parent ?? Session.get(input.sessionID)

      const dirty = await isDirty()
      if (!input.allowDirty && dirty) {
        throw new WorkingTreeDirtyError({ message: "Working tree has uncommitted changes." })
      }

      if (!parent.benchmark.appliedSessionID) {
        // Nothing applied, nothing to undo
        return parent
      }

      if (!parent.benchmark.checkpointSnapshot) {
        throw new SnapshotUnavailableError({
          message: "No checkpoint snapshot available to undo.",
        })
      }

      const appliedSnapshot = await Snapshot.track()
      if (!appliedSnapshot) {
        throw new SnapshotUnavailableError({
          message: "Benchmark mode requires snapshots (git) to be enabled.",
        })
      }

      const appliedChild = await Session.get(parent.benchmark.appliedSessionID)
      if (isChild(appliedChild) && appliedChild.benchmark.parentID === parent.id) {
        await updateChildSnapshot(appliedChild.id, appliedSnapshot)
        const appliedChildWorktree = await ensureChildWorktree(parent, appliedChild)
        await Snapshot.restoreTo(appliedSnapshot, appliedChildWorktree, { cleanUntracked: true })
      }

      // Simply restore the checkpoint
      await Snapshot.restoreTo(parent.benchmark.checkpointSnapshot, Instance.worktree, { cleanUntracked: true })

      return Session.update(parent.id, (draft) => {
        if (draft.benchmark?.type === "parent") {
          draft.benchmark.appliedSessionID = undefined
          draft.benchmark.checkpointSnapshot = undefined
        }
      })
    })
  }

  export function hasDuplicates(models: BenchmarkSchema.Model[]) {
    const seen = new Set<string>()
    for (const model of models) {
      const key = `${model.providerID}/${model.modelID}`
      if (seen.has(key)) return true
      seen.add(key)
    }
    return false
  }

  async function resolveModels(input: {
    sessionID: string
    count?: number
    models?: BenchmarkSchema.Model[]
  }): Promise<BenchmarkSchema.Model[]> {
    if (input.models && input.models.length > 0) return input.models
    const count = input.count ?? 2
    const model = await resolveSessionModel(input.sessionID)
    return Array.from({ length: count }, () => ({ ...model }))
  }

  async function resolveSessionModel(sessionID: string) {
    const messages = await Session.messages({ sessionID })
    const lastUser = messages.findLast((x) => x.info.role === "user")
    if (lastUser && "model" in lastUser.info) {
      return lastUser.info.model
    }
    return Provider.defaultModel()
  }

  async function isDirty() {
    if (Instance.project.vcs !== "git") return false
    const result = await $`git status --porcelain`.quiet().cwd(Instance.worktree).nothrow()
    return result.exitCode === 0 && result.text().trim().length > 0
  }

  export async function ensureChildWorktree(
    parent: Session.Info & { benchmark: BenchmarkSchema.Parent },
    child: Session.Info & { benchmark: BenchmarkSchema.ChildSession },
  ) {
    const worktree =
      child.benchmark.worktree ?? path.join(Global.Path.data, "benchmark", parent.id, child.id)
    const exists = await fs
      .stat(worktree)
      .then(() => true)
      .catch(() => false)
    if (!exists) {
      await fs.mkdir(worktree, { recursive: true })
      if (parent.benchmark.baseSnapshot) {
        await Snapshot.restoreTo(parent.benchmark.baseSnapshot, worktree, { cleanUntracked: true })
      }
      await Session.update(child.id, (draft) => {
        if (draft.benchmark?.type === "child") {
          draft.benchmark.worktree = worktree
        }
      })
      await Session.update(parent.id, (draft) => {
        if (draft.benchmark?.type === "parent") {
          const entry = draft.benchmark.children.find((item) => item.sessionID === child.id)
          if (entry) entry.worktree = worktree
        }
      })
    }
    return worktree
  }
}
