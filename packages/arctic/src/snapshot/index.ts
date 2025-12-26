import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })

  export async function track() {
    if (Instance.project.vcs !== "git") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    if (await fs.mkdir(git, { recursive: true })) {
      await $`git init`
        .env({
          ...process.env,
          GIT_DIR: git,
          GIT_WORK_TREE: Instance.worktree,
        })
        .quiet()
        .nothrow()
      // Configure git to not convert line endings on Windows
      await $`git --git-dir ${git} config core.autocrlf false`.quiet().nothrow()
      log.info("initialized")
    }
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add -A -- .`
      .quiet()
      .cwd(Instance.worktree)
      .nothrow()
    const hash = await $`git --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .text()
    log.info("tracking", { hash, cwd: Instance.directory, git })
    return hash.trim()
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    const git = gitdir()
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add -A -- .`
      .quiet()
      .cwd(Instance.worktree)
      .nothrow()
    const result =
      await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-only ${hash} -- .`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()

    // If git diff fails, return empty patch
    if (result.exitCode !== 0) {
      log.warn("failed to get diff", { hash, exitCode: result.exitCode })
      return { hash, files: [] }
    }

    const files = result.text()
    return {
      hash,
      files: files
        .trim()
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => path.join(Instance.worktree, x)),
    }
  }

  export async function restore(snapshot: string, options?: { cleanUntracked?: boolean }) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()
    const result =
      await $`git --git-dir ${git} --work-tree ${Instance.worktree} read-tree ${snapshot} && git --git-dir ${git} --work-tree ${Instance.worktree} checkout-index -a -f`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    if (result.exitCode !== 0) {
      log.error("failed to restore snapshot", {
        snapshot,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return
    }

    if (options?.cleanUntracked) {
      const clean = await $`git --git-dir ${git} --work-tree ${Instance.worktree} clean -fd`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()
      if (clean.exitCode !== 0) {
        log.warn("failed to clean untracked files", {
          snapshot,
          exitCode: clean.exitCode,
          stderr: clean.stderr.toString(),
          stdout: clean.stdout.toString(),
        })
      }
    }
  }

  export async function restoreTo(
    snapshot: string,
    worktree: string,
    options?: { cleanUntracked?: boolean },
  ) {
    log.info("restore", { commit: snapshot, worktree })
    const git = gitdir()

    // Use checkout-index with --force to remove files not in the snapshot
    // First, clear the working tree of tracked files, then restore from snapshot
    const result =
      await $`git --git-dir ${git} --work-tree ${worktree} read-tree --reset ${snapshot} && git --git-dir ${git} --work-tree ${worktree} checkout-index -a -f --prefix=${worktree}/`
        .quiet()
        .cwd(worktree)
        .nothrow()

    if (result.exitCode !== 0) {
      // Fallback to simpler approach
      const readResult = await $`git --git-dir ${git} --work-tree ${worktree} read-tree ${snapshot}`
        .quiet()
        .cwd(worktree)
        .nothrow()

      if (readResult.exitCode !== 0) {
        log.error("failed to restore snapshot", {
          snapshot,
          worktree,
          exitCode: readResult.exitCode,
          stderr: readResult.stderr.toString(),
          stdout: readResult.stdout.toString(),
        })
        return
      }

      // Get list of files in the snapshot
      const lsTree = await $`git --git-dir ${git} ls-tree -r --name-only ${snapshot}`
        .quiet()
        .cwd(worktree)
        .nothrow()

      if (lsTree.exitCode === 0) {
        const snapshotFiles = new Set(lsTree.text().trim().split("\n").filter(Boolean))

        // Get all files in worktree
        const allFiles = await $`find . -type f ! -path './.git/*'`
          .quiet()
          .cwd(worktree)
          .nothrow()

        if (allFiles.exitCode === 0) {
          const worktreeFiles = allFiles.text().trim().split("\n").filter(Boolean).map(f => f.startsWith('./') ? f.slice(2) : f)

          // Delete files that aren't in the snapshot
          for (const file of worktreeFiles) {
            if (!snapshotFiles.has(file)) {
              await fs.unlink(path.join(worktree, file)).catch(() => {})
            }
          }
        }
      }

      // Checkout files from snapshot
      await $`git --git-dir ${git} --work-tree ${worktree} checkout-index -a -f`
        .quiet()
        .cwd(worktree)
        .nothrow()
    }

    if (options?.cleanUntracked) {
      const clean = await $`git --git-dir ${git} --work-tree ${worktree} clean -fd`
        .quiet()
        .cwd(worktree)
        .nothrow()
      if (clean.exitCode !== 0) {
        log.warn("failed to clean untracked files", {
          snapshot,
          worktree,
          exitCode: clean.exitCode,
          stderr: clean.stderr.toString(),
          stdout: clean.stdout.toString(),
        })
      }
    }
  }

  export async function revert(patches: Patch[]) {
    const files = new Set<string>()
    const git = gitdir()
    for (const item of patches) {
      for (const file of item.files) {
        if (files.has(file)) continue
        log.info("reverting", { file, hash: item.hash })
        const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} checkout ${item.hash} -- ${file}`
          .quiet()
          .cwd(Instance.worktree)
          .nothrow()
        if (result.exitCode !== 0) {
          const relativePath = path.relative(Instance.worktree, file)
          const checkTree =
            await $`git --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${item.hash} -- ${relativePath}`
              .quiet()
              .cwd(Instance.worktree)
              .nothrow()
          if (checkTree.exitCode === 0 && checkTree.text().trim()) {
            log.info("file existed in snapshot but checkout failed, keeping", {
              file,
            })
          } else {
            log.info("file did not exist in snapshot, deleting", { file })
            await fs.unlink(file).catch(() => {})
          }
        }
        files.add(file)
      }
    }
  }

  export async function diff(hash: string) {
    const git = gitdir()
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add -A -- .`
      .quiet()
      .cwd(Instance.worktree)
      .nothrow()
    const result =
      await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff ${hash} -- .`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    if (result.exitCode !== 0) {
      log.warn("failed to get diff", {
        hash,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return ""
    }

    return result.text().trim()
  }

  export async function applyPatch(patch: string, options?: { threeWay?: boolean; reverse?: boolean }) {
    if (!patch.trim()) return true
    const git = gitdir()
    const dir = path.join(Global.Path.data, "tmp")
    await fs.mkdir(dir, { recursive: true }).catch(() => {})
    const filename = `snapshot-${Date.now()}-${Math.random().toString(16).slice(2)}.patch`
    const filepath = path.join(dir, filename)
    await fs.writeFile(filepath, patch)
    const applyArgs = [
      "apply",
      options?.reverse ? "-R" : null,
      options?.threeWay ? "--3way" : null,
      "--whitespace=nowarn",
      "--unsafe-paths",
      filepath,
    ].filter(Boolean)
    const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} ${applyArgs}`
      .quiet()
      .cwd(Instance.worktree)
      .nothrow()
    await fs.unlink(filepath).catch(() => {})
    if (result.exitCode !== 0) {
      log.warn("failed to apply patch", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return false
    }
    return true
  }

  export async function diffBetween(from: string, to: string) {
    const git = gitdir()
    const result =
      await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff ${from} ${to} -- .`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    if (result.exitCode !== 0) {
      log.warn("failed to get diff between snapshots", {
        from,
        to,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return ""
    }

    return result.text().trim()
  }

  export function diffFiles(patch: string): string[] {
    const files: string[] = []
    for (const line of patch.split("\n")) {
      if (!line.startsWith("diff --git ")) continue
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      if (match?.[2]) files.push(match[2])
    }
    return files
  }

  export function filterPatch(patch: string, options: { exclude: Set<string> }): string {
    if (!patch.trim()) return ""
    const blocks: string[] = []
    let current: string[] = []
    let currentFile: string | undefined

    const flush = () => {
      if (!current.length) return
      if (!currentFile || !options.exclude.has(currentFile)) {
        blocks.push(current.join("\n"))
      }
      current = []
      currentFile = undefined
    }

    for (const line of patch.split("\n")) {
      if (line.startsWith("diff --git ")) {
        flush()
        current.push(line)
        const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
        currentFile = match?.[2]
        continue
      }
      current.push(line)
    }
    flush()
    return blocks.join("\n").trim()
  }

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>
  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    const git = gitdir()
    const result: FileDiff[] = []
    for await (const line of $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .lines()) {
      if (!line) continue
      const [additions, deletions, file] = line.split("\t")
      const isBinaryFile = additions === "-" && deletions === "-"
      const before = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${from}:${file}`
            .quiet()
            .nothrow()
            .text()
      const after = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${to}:${file}`
            .quiet()
            .nothrow()
            .text()
      result.push({
        file,
        before,
        after,
        additions: parseInt(additions),
        deletions: parseInt(deletions),
      })
    }
    return result
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }
}
