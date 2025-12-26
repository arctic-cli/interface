import path from "path"
import { Global } from "../global"
import z from "zod"

export namespace Prompts {
  export const Prompt = z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    category: z.string().optional(),
  })
  export type Prompt = z.infer<typeof Prompt>

  export const Store = z.object({
    prompts: z.array(Prompt),
  })
  export type Store = z.infer<typeof Store>

  const filepath = path.join(Global.Path.data, "prompts.json")

  async function readStore(): Promise<Store> {
    const file = Bun.file(filepath)
    const exists = await file.exists()
    if (!exists) {
      return { prompts: [] }
    }
    try {
      const data = await file.json()
      const parsed = Store.safeParse(data)
      if (!parsed.success) {
        console.error("Failed to parse prompts file:", parsed.error)
        return { prompts: [] }
      }
      return parsed.data
    } catch (e) {
      console.error("Failed to read prompts file:", e)
      return { prompts: [] }
    }
  }

  async function writeStore(store: Store): Promise<void> {
    await Bun.write(filepath, JSON.stringify(store, null, 2))
  }

  export async function save(prompt: Omit<Prompt, "id">): Promise<Prompt> {
    const store = await readStore()
    const id = crypto.randomUUID()
    const newPrompt: Prompt = { ...prompt, id }
    store.prompts.push(newPrompt)
    await writeStore(store)
    return newPrompt
  }

  export async function list(): Promise<Prompt[]> {
    const store = await readStore()
    return store.prompts
  }

  export async function remove(id: string): Promise<boolean> {
    const store = await readStore()
    const index = store.prompts.findIndex((p) => p.id === id)
    if (index === -1) return false
    store.prompts.splice(index, 1)
    await writeStore(store)
    return true
  }

  export async function getCategories(): Promise<string[]> {
    const store = await readStore()
    const categories = new Set<string>()
    for (const prompt of store.prompts) {
      if (prompt.category) {
        categories.add(prompt.category)
      }
    }
    return Array.from(categories).sort()
  }

  export async function getByCategory(category?: string): Promise<Prompt[]> {
    const store = await readStore()
    if (!category) {
      return store.prompts.filter((p) => !p.category)
    }
    return store.prompts.filter((p) => p.category === category)
  }
}
