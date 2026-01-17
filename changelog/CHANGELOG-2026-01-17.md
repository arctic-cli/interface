# Changelog - January 17, 2026

## Bug Fixes

### AI not stopping at end of reply

- Fix session processor not setting status to idle after completion
- Fix session prompt loop not properly resetting status on abort/completion
- Ensure status is always set to idle when cancelling, even if state is out of sync
- Fix incomplete message detection logic - only "tool-calls" finish reason triggers retry
- Refetch session status on server reconnect to sync TUI state

### OpenCode project config not imported

- Search project directories (walking up from cwd) for .opencode folder before falling back to global config
- Support .opencode directories alongside .arctic for config, commands, and agents
- Fix config path detection to properly import project-level OpenCode settings

### Codex not shown in providers modal

- Add Codex and Antigravity to the provider list endpoint
- Add Codex to auth login command with proper ordering and description
- Fix Codex model ID mapping (gpt-5.1 to gpt-5.2)

### Onboarding ESC key handling

- Fix ESC in provider dialog closing entire onboarding instead of just the dialog
- Prevent ESC from skipping onboarding (only 's' key should skip, as UI indicates)
- Add `defaultPrevented` check to respect dialog keyboard handling

### Onboarding button text invisible on transparent themes

- Fix button text using `theme.background` which is transparent on Arctic theme
- Use `selectedForeground()` helper to calculate proper contrast color for button text

## Features

### Shimmer "working" text indicator

- Add animated shimmer text component for TUI
- Display "working" indicator when AI is processing but no visible output yet
- Add CSS shimmer animation for web UI component

### Transparent color themes

- Add 7 new themes with transparent background support: arctic, cyberpunk, ember, forest, ocean, pastel, sunset, transparent
- Add rgba() color parsing for theme definitions
- Mark transparent-capable themes with [transparent] label in theme picker
- Remove dark overlay from dialog component for better transparency

### Mouse click on model to change model

- Add clickable model display in prompt bar
- Clicking the model name opens the model selection dialog
- Add "Select model" command to command palette

## Documentation

### README redesign

- Replace direct marketing copy with clean, centered layout
- Add centered logo, simple tagline, and badge links
- Use static screenshot instead of animated GIF
- Separate install and run commands with shell reload step
- Simplify image URLs for usage screenshots

## Internal

- Remove console.error logging from Anthropic OAuth token handling
- Fix retry logic to respect maxRetries limit
- Persist theme selection to local storage with proper priority

---

**Summary**: This release fixes several UX issues including AI responses not properly completing, OpenCode project configs not being imported, Codex missing from the provider list, and onboarding flow issues with ESC key handling and button visibility on transparent themes. New transparent themes and a shimmer "working" indicator are added. The README is redesigned with a cleaner, less marketing-heavy style.
