// IMPORTANT: Set env vars BEFORE any imports from src/ directory
// xdg-basedir reads env vars at import time, so we must set these first
import os from "os"
import path from "path"
import fs from "fs/promises"

const dir = path.join(os.tmpdir(), "arctic-test-data-" + process.pid)
await fs.mkdir(dir, { recursive: true })
process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")

// Copy models cache from user's cache to test cache
const userModelsCache = path.join(os.homedir(), ".cache/arctic/models.json")
const testModelsCache = path.join(dir, "cache/arctic/models.json")
try {
  await fs.mkdir(path.dirname(testModelsCache), { recursive: true })
  await fs.copyFile(userModelsCache, testModelsCache)
  const stat = await fs.stat(testModelsCache)
  console.log("Copied models cache from", userModelsCache, "to", testModelsCache, "size:", stat.size)
} catch (e) {
  console.log("Failed to copy models cache, fetching fresh:", e)
  // If copy fails, download fresh data
  const response = await fetch("https://models.dev/api.json")
  const data = await response.text()
  await fs.mkdir(path.dirname(testModelsCache), { recursive: true })
  await fs.writeFile(testModelsCache, data)
  console.log("Downloaded and saved models cache to", testModelsCache)
}

// Clear provider env vars to ensure clean test state
delete process.env["ANTHROPIC_API_KEY"]
delete process.env["OPENAI_API_KEY"]
delete process.env["GOOGLE_API_KEY"]
delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"]
delete process.env["AZURE_OPENAI_API_KEY"]
delete process.env["AWS_ACCESS_KEY_ID"]
delete process.env["AWS_PROFILE"]
delete process.env["OPENROUTER_API_KEY"]
delete process.env["GROQ_API_KEY"]
delete process.env["MISTRAL_API_KEY"]
delete process.env["PERPLEXITY_API_KEY"]
delete process.env["TOGETHER_API_KEY"]
delete process.env["XAI_API_KEY"]
delete process.env["DEEPSEEK_API_KEY"]
delete process.env["FIREWORKS_API_KEY"]
delete process.env["CEREBRAS_API_KEY"]
delete process.env["SAMBANOVA_API_KEY"]

// Now safe to import from src/
const { Log } = await import("../src/util/log")

Log.init({
  print: false,
  dev: true,
  level: "DEBUG",
})
