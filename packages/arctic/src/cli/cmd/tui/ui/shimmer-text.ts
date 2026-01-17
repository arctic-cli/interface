import type { ColorInput } from "@opentui/core"
import { RGBA } from "@opentui/core"
import type { ColorGenerator } from "opentui-spinner"

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

const BULLET = "● "

export function getRandomWord(): string {
  return BULLET + WORDS[Math.floor(Math.random() * WORDS.length)] + "..."
}

export interface ShimmerTextOptions {
  color: ColorInput
  baseColor?: ColorInput
  trailLength?: number
}

export function createShimmerFrames(text: string, _options: ShimmerTextOptions): string[] {
  const totalFrames = text.length * 2 + 10

  return Array.from({ length: totalFrames }, () => text)
}

export function createShimmerColors(_text: string, options: ShimmerTextOptions): ColorGenerator {
  const trailLength = options.trailLength ?? 4

  const highlightRgba = options.color instanceof RGBA ? options.color : RGBA.fromHex(options.color as string)
  const baseRgba = options.baseColor
    ? options.baseColor instanceof RGBA
      ? options.baseColor
      : RGBA.fromHex(options.baseColor as string)
    : highlightRgba

  const trailColors: RGBA[] = []
  for (let i = 0; i < trailLength; i++) {
    const t = i / trailLength
    const r = highlightRgba.r * (1 - t) + baseRgba.r * t
    const g = highlightRgba.g * (1 - t) + baseRgba.g * t
    const b = highlightRgba.b * (1 - t) + baseRgba.b * t
    trailColors.push(RGBA.fromValues(r, g, b, 1.0))
  }

  return (frameIndex: number, charIndex: number, _totalFrames: number, totalChars: number) => {
    if (charIndex < BULLET.length) {
      return baseRgba
    }

    const adjustedCharIndex = charIndex - BULLET.length
    const adjustedTotalChars = totalChars - BULLET.length
    const cycleLength = adjustedTotalChars + trailLength + 5
    const position = frameIndex % cycleLength

    const distance = position - adjustedCharIndex

    if (distance >= 0 && distance < trailLength) {
      return trailColors[distance] ?? baseRgba
    }

    return baseRgba
  }
}
