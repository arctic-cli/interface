import { createSignal, For, Show } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogConfirm } from "../ui/dialog-confirm"
import { type DialogContext } from "../ui/dialog"
import { Prompts } from "@/prompts/prompts"
import { useToast, type ToastContext } from "../ui/toast"

export namespace DialogPrompts {
  export type Action = "save" | "list" | "delete" | "use"

  export async function show(dialog: DialogContext, toast: ToastContext, action: Action, currentInput?: string) {
    if (action === "save") {
      if (!currentInput || currentInput.trim() === "") {
        toast.show({
          variant: "error",
          message: "Cannot save empty prompt",
          duration: 3000,
        })
        return
      }

      // Ask for title
      const title = await DialogPrompt.show(dialog, "Save Prompt", {
        placeholder: "Enter title (optional)",
      })

      if (title === null) return // User cancelled

      const finalTitle = title.trim() || currentInput.split(/\s+/).slice(0, 5).join(" ")

      // Ask for category
      const existingCategories = await Prompts.getCategories()
      const category = await DialogPrompt.show(dialog, "Category", {
        placeholder: "Enter category (optional)",
        description: () =>
          existingCategories.length > 0 ? (
            <text style={{ fg: "dim" }}>Existing: {existingCategories.join(", ")}</text>
          ) : undefined,
      })

      if (category === null) return // User cancelled

      const finalCategory = category.trim() || undefined

      // Save the prompt
      await Prompts.save({
        title: finalTitle,
        content: currentInput,
        category: finalCategory,
      })

      toast.show({
        variant: "success",
        message: `Prompt "${finalTitle}" saved`,
        duration: 3000,
      })
    } else if (action === "list" || action === "use" || action === "delete") {
      const prompts = await Prompts.list()

      if (prompts.length === 0) {
        toast.show({
          variant: "info",
          message: "No saved prompts",
          duration: 3000,
        })
        return
      }

      const options: DialogSelectOption<Prompts.Prompt>[] = prompts.map((prompt) => ({
        title: prompt.title,
        value: prompt,
        category: prompt.category,
        description: prompt.content.substring(0, 100) + (prompt.content.length > 100 ? "..." : ""),
      }))

      if (action === "list") {
        await new Promise<void>((resolve) => {
          dialog.replace(
            () => (
              <DialogSelect
                title="Saved Prompts"
                placeholder="Search prompts"
                options={options}
                onSelect={() => {
                  dialog.clear()
                  resolve()
                }}
              />
            ),
            () => resolve(),
          )
        })
      } else if (action === "use") {
        const selectedPrompt = await new Promise<Prompts.Prompt | null>((resolve) => {
          dialog.replace(
            () => (
              <DialogSelect
                title="Use Prompt"
                placeholder="Search prompts"
                options={options}
                onSelect={(option) => {
                  // Don't clear here - let the next dialog replace this one
                  resolve(option.value)
                }}
              />
            ),
            () => resolve(null),
          )
        })

        if (!selectedPrompt) {
          dialog.clear()
          return
        }

        // Ask how to use it
        const useOptions: DialogSelectOption<"replace" | "append">[] = [
          {
            title: "Replace current input",
            value: "replace",
            description: "Replace the entire input with this prompt",
          },
          {
            title: "Append to current input",
            value: "append",
            description: "Add this prompt to the end of current input",
          },
        ]

        const useMode = await new Promise<"replace" | "append" | null>((resolve) => {
          dialog.replace(
            () => (
              <DialogSelect
                title="How to use this prompt?"
                placeholder="Select mode"
                options={useOptions}
                onSelect={(option) => {
                  resolve(option.value)
                }}
              />
            ),
            () => resolve(null),
          )
        })

        // Clear the dialog now that we have the result
        dialog.clear()

        if (!useMode) return

        return {
          prompt: selectedPrompt,
          mode: useMode,
        }
      } else if (action === "delete") {
        const selectedPrompt = await new Promise<Prompts.Prompt | null>((resolve) => {
          dialog.replace(
            () => (
              <DialogSelect
                title="Delete Prompt"
                placeholder="Search prompts"
                options={options}
                onSelect={(option) => {
                  dialog.clear()
                  resolve(option.value)
                }}
              />
            ),
            () => resolve(null),
          )
        })

        if (!selectedPrompt) return

        const confirmed = await DialogConfirm.show(dialog, "Delete Prompt", `Delete "${selectedPrompt.title}"?`)

        if (!confirmed) return

        await Prompts.remove(selectedPrompt.id)

        toast.show({
          variant: "success",
          message: `Prompt "${selectedPrompt.title}" deleted`,
          duration: 3000,
        })
      }
    }
  }
}
