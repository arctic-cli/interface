# Changelog - January 20, 2026

## Features

### Thinking level toggle

- Add Ctrl+T keybind to cycle through thinking levels (low/medium/high) for reasoning models
- Display thinking level indicator next to model name in prompt footer with color coding:
  - Low: muted color
  - Medium: warning color (yellow/orange)
  - High: primary color (accent)
- Only show indicator for models that support reasoning (GPT-5, Claude Opus, Gemini thinking variants)
- Persist thinking level preference to ~/.local/state/arctic/thinking.json
- Pass thinking level to provider-specific reasoning parameters (reasoningEffort for OpenAI, thinkingConfig for Google)

## Enhancements

### Improved user message UI

- Simplify user message display with cleaner styling
- Remove background color and use bold ">" prefix
- Display user text in primary color for better visibility
- Remove markdown rendering option for user messages (plain text only)

### Increased input height

- Increase maximum input height from 5 to 8 lines
- Allows for longer prompts without scrolling

### Pastel theme improvements

- Fix pastel theme for dark mode compatibility
- Update color palette with proper dark background colors
- Improve contrast for text and UI elements in dark mode

## Refactoring

### Simplified Codex model variants

- Remove redundant reasoning effort model variants (-low, -medium, -high, -xhigh) for Codex models
- Users now select base model (gpt-5.2-codex, gpt-5.1-codex-max, gpt-5.1-codex) and use Ctrl+T to adjust thinking level
- Clean up model mappings in codex-oauth helper

## Bug Fixes

### Error handling improvements

- Add error handling in stats command when reading sessions/projects
- Graceful fallback when native file watcher binding fails to load
- Prevent crashes from corrupted storage files

---

**Summary**: This release adds a thinking level toggle (Ctrl+T) that lets users control reasoning effort for supported models, improves the user message UI with cleaner styling, increases input height for longer prompts, and simplifies the Codex model list by removing redundant reasoning variants.
