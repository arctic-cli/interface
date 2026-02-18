import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import JSZip from "jszip"
import path from "path"

export namespace ConfigExport {
  const log = Log.create({ service: "config-export" })

  interface FileEntry {
    path: string
    content: Buffer | string
    relativePath: string
  }

  async function collectFilesFromDirectory(dir: string, prefix: string): Promise<FileEntry[]> {
    const files: FileEntry[] = []

    const patterns = [
      "arctic.json",
      "arctic.jsonc",
      "config.json",
      "agent/**/*.md",
      "agents/**/*.md",
      "command/**/*.md",
      "commands/**/*.md",
      "mode/*.md",
      "plugin/*.ts",
      "plugin/*.js",
      "plugins/*.ts",
      "plugins/*.js",
      "package.json",
      "bun.lock",
    ]

    for (const pattern of patterns) {
      const glob = new Bun.Glob(pattern)
      for await (const item of glob.scan({
        absolute: true,
        cwd: dir,
        dot: true,
        followSymlinks: true,
      })) {
        const file = Bun.file(item)
        const exists = await file.exists()
        if (!exists) continue

        const content = await file.arrayBuffer().catch(() => null)
        if (!content) continue

        const relativePath = path.relative(dir, item)
        files.push({
          path: item,
          content: Buffer.from(content),
          relativePath: path.join(prefix, relativePath),
        })

        log.debug("collected file", { path: item, relativePath: path.join(prefix, relativePath) })
      }
    }

    return files
  }

  async function collectFiles(): Promise<FileEntry[]> {
    const files: FileEntry[] = []

    const globalFiles = await collectFilesFromDirectory(Global.Path.config, "global")
    files.push(...globalFiles)

    const arcticDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".arctic"],
        start: Instance.directory,
        stop: Instance.worktree,
      }),
    )

    for (const arcticDir of arcticDirs) {
      const projectFiles = await collectFilesFromDirectory(arcticDir, "project/.arctic")
      files.push(...projectFiles)
    }

    const rootPatterns = ["arctic.json", "arctic.jsonc"]
    for (const pattern of rootPatterns) {
      const found = await Filesystem.findUp(pattern, Instance.directory, Instance.worktree)
      for (const resolved of found) {
        const file = Bun.file(resolved)
        const exists = await file.exists()
        if (!exists) continue

        const content = await file.arrayBuffer().catch(() => null)
        if (!content) continue

        const filename = path.basename(resolved)
        files.push({
          path: resolved,
          content: Buffer.from(content),
          relativePath: path.join("project", filename),
        })

        log.debug("collected root file", { path: resolved })
      }
    }

    log.info("collected files", { count: files.length })
    return files
  }

  async function createZip(files: FileEntry[]): Promise<Buffer> {
    const zip = new JSZip()

    const readme = `# Arctic Configuration Backup
Generated: ${new Date().toISOString()}

## Structure

- global/ - Files from ~/.config/arctic/
- project/ - Files from your project's .arctic/ directory and root config files

## Restore Instructions

To restore this configuration, use the \`/config-import\` command (coming soon) or manually:

1. Extract this zip file
2. Copy files from global/ to ~/.config/arctic/
3. Copy files from project/ to your project directory

Note: Auth tokens are NOT included in this backup for security reasons.
`

    zip.file("README.md", readme)

    for (const file of files) {
      zip.file(file.relativePath, file.content)
      log.debug("added to zip", { relativePath: file.relativePath })
    }

    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: {
        level: 9,
      },
    })

    return buffer
  }

  export async function backup(): Promise<Buffer> {
    log.info("starting config backup")
    const files = await collectFiles()
    const zipBuffer = await createZip(files)
    log.info("config backup created", { size: zipBuffer.length })
    return zipBuffer
  }
}
