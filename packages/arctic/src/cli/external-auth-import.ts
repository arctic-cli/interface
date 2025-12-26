import * as prompts from "@clack/prompts"
import { Auth } from "../auth"
import { Storage } from "../storage/storage"

type ExternalAuthImportState = {
  asked: boolean
  decision: "yes" | "no"
  decidedAt: number
  providers: string[]
}

const STATE_KEY = ["cli", "external-auth-import"]
const PROVIDER_LABELS: Record<string, string> = {
  codex: "OpenAI Codex",
  google: "Google (Gemini)",
}

async function readState() {
  return Storage.read<ExternalAuthImportState>(STATE_KEY).catch((err) => {
    if (err instanceof Storage.NotFoundError) return undefined
    throw err
  })
}

export async function maybeImportExternalAuth() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return
  if (process.env.CI) return
  if (process.argv.some((arg) => ["-h", "--help", "-v", "--version"].includes(arg))) return

  const external = await Auth.external()
  const externalProviders = Object.keys(external)
  if (externalProviders.length === 0) return

  const local = await Auth.all()
  const missing = externalProviders.filter((providerID) => !local[providerID])
  if (missing.length === 0) return

  const state = await readState()
  if (state?.asked) {
    if (state.decision === "no") return
    if (state.decision === "yes") {
      for (const providerID of missing) {
        await Auth.set(providerID, external[providerID])
      }
    }
    return
  }

  const labels = missing.map((providerID) => PROVIDER_LABELS[providerID] ?? providerID)
  const confirm = await prompts.confirm({
    message: `Found existing credentials for ${labels.join(", ")}. Auto-connect now?`,
    initialValue: true,
  })
  if (prompts.isCancel(confirm)) return

  const dontAskAgain = await prompts.confirm({
    message: "Don't ask again about auto-connecting external credentials?",
    initialValue: true,
  })
  if (!prompts.isCancel(dontAskAgain) && dontAskAgain) {
    await Storage.write<ExternalAuthImportState>(STATE_KEY, {
      asked: true,
      decision: confirm ? "yes" : "no",
      decidedAt: Date.now(),
      providers: missing,
    })
  }

  if (!confirm) return

  for (const providerID of missing) {
    await Auth.set(providerID, external[providerID])
  }
}
