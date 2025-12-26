import fs from "fs"
import path from "path"
import { homedir } from "os"

export type RecentSessionSummary = {
  id: string
  title?: string
  updated?: number
}

const DATA_HOME = process.env.XDG_DATA_HOME?.trim() || path.join(homedir(), ".local", "share")
const STORAGE_ROOT = path.join(DATA_HOME, "arctic", "storage")
const SESSION_ROOT = path.join(STORAGE_ROOT, "session")
const PROJECT_ROOT = path.join(STORAGE_ROOT, "project")

type StoredSessionRecord = {
  id?: string
  title?: string
  parentID?: string | null
  time?: {
    updated?: number
  }
}

type StoredProjectRecord = {
  id?: string
  worktree?: string
}

export function loadRecentSessions(limit = 5, cwd: string = process.cwd()): RecentSessionSummary[] {
  const projects = resolveProjectIDsForCwd(cwd)
  const targetProjects = projects.length > 0 ? projects : listAllProjectIDs()
  if (targetProjects.length === 0) return []

  const sessions: RecentSessionSummary[] = []
  for (const projectID of targetProjects) {
    const sessionDir = path.join(SESSION_ROOT, projectID)
    let files: string[]
    try {
      files = fs.readdirSync(sessionDir)
    } catch {
      continue
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue
      const record = readJson<StoredSessionRecord>(path.join(sessionDir, file))
      if (!record || record.parentID) continue
      const updated = record.time?.updated
      if (typeof updated !== "number") continue
      sessions.push({
        id: record.id ?? file.replace(/\.json$/, ""),
        title: record.title,
        updated,
      })
    }
  }

  sessions.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
  return sessions.slice(0, limit)
}

function resolveProjectIDsForCwd(cwd: string): string[] {
  const normalizedCwd = path.resolve(cwd)
  let files: string[]
  try {
    files = fs.readdirSync(PROJECT_ROOT)
  } catch {
    return []
  }

  const matches: string[] = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    const project = readJson<StoredProjectRecord>(path.join(PROJECT_ROOT, file))
    if (!project?.worktree) continue
    const normalizedWorktree = path.resolve(project.worktree)
    if (pathsOverlap(normalizedWorktree, normalizedCwd)) {
      matches.push(project.id ?? file.replace(/\.json$/, ""))
    }
  }
  return matches
}

function listAllProjectIDs(): string[] {
  try {
    return fs
      .readdirSync(SESSION_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function readJson<T>(target: string): T | undefined {
  try {
    const raw = fs.readFileSync(target, "utf8")
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

function pathsOverlap(a: string, b: string): boolean {
  return isWithin(a, b) || isWithin(b, a)
}

function isWithin(target: string, base: string): boolean {
  const relative = path.relative(base, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
