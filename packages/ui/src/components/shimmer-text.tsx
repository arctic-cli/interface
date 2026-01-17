import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js"
import "./shimmer-text.css"

const WORDS = [
  "Arcticing",
  "Streaming",
  "Working",
  "Thinking",
  "Computing",
  "Processing",
  "Pondering",
  "Brewing",
  "Conjuring",
  "Manifesting",
  "Vibing",
  "Cooking",
  "Simmering",
  "Crafting",
  "Weaving",
]

export function ShimmerText(props: { class?: string }) {
  const [index, setIndex] = createSignal(Math.floor(Math.random() * WORDS.length))

  onMount(() => {
    const interval = setInterval(() => {
      setIndex(Math.floor(Math.random() * WORDS.length))
    }, 4000)
    onCleanup(() => clearInterval(interval))
  })

  const word = createMemo(() => WORDS[index()] + "...")
  const chars = createMemo(() => word().split(""))

  return (
    <span data-component="shimmer-text" class={props.class}>
      <span class="shimmer-bullet">● </span>
      <For each={chars()}>
        {(char, i) => (
          <span
            class="shimmer-char"
            style={{ "--char-index": i() }}
          >
            {char}
          </span>
        )}
      </For>
    </span>
  )
}
