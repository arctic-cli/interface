# Changelog - January 13, 2026

## New Features

### Multi-account provider connections

- Add connection-aware auth keys and helpers for formatting, parsing, and validation
- Introduce connection-aware login flows for CLI and TUI auth
- Add a Manage Connections dialog with delete support

## TUI Improvements

### Agent and prompt UX

- Persist selected agent across restarts
- Make selection copy work without double key presses
- Add /connections command and prompt autocomplete entry
- Adjust usage dialog navigation, search, and provider tabs
- Fix usage dialog sizing and overflow behavior

## Provider Integration

### Connection-aware usage and providers

- Support base providers for connection IDs in provider and usage logic
- Allow MiniMax usage tracking with corrected limit calculations

## Bug Fixes

### Usage limits and copy behavior

- Fix MiniMax limit calculations in usage display
- Fix copy key handling when selection is active
- Fix usage limits dialog overflow

## Documentation

### Usage limits

- Update CLI usage documentation to include MiniMax in supported providers

## Dependencies

### TUI runtime

- Update OpenTUI core and solid packages

---

**Summary**: This release adds multi-account provider connections, improves TUI usage and copy workflows, and fixes MiniMax usage limits handling. It also updates documentation and bumps OpenTUI dependencies.