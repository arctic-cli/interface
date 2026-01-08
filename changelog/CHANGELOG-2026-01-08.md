# Changelog - January 8, 2026

## TUI Improvements

### Usage Dialog Enhancement

- Added search bar to filter providers by name or ID
- Search input has 500ms debounce for smooth typing experience
- ESC key clears search query when text is present
- Auto-focuses search input when dialog opens
- Displays "No matches found" message when search returns no results
- Auto-selects first provider from filtered results

### Keybindings

- Added <leader> u shortcut to open usage dialog from command palette
- Updated configuration schema to include usage_view keybind

### Permission Bypass Warning

- Changed permission bypass warning text to be more concise
- Made warning text bold for better visibility
- Updated from verbose message to simple "permission bypass enabled"

### Session Layout

- Removed left padding from message scrollbox for cleaner appearance
- Adjusted user message padding for consistent spacing

## Bug Fixes

### Copy Functionality

- Fixed copy not working when text is selected on screen
- Reordered keyboard event priority to check selection first
- Copy now works regardless of prompt input state
- Fixed double ctrl+c exit detection interfering with copy

### Streaming Indicator

- Fixed "Streaming..." text persisting after message cancellation
- Added session status check to verify streaming state
- Streaming indicator now properly disappears when session is not busy

### Installation Script

- Fixed Arctic not being immediately available in PATH after first install
- Added PATH export to current session during installation
- Added helpful message to source config file or restart terminal
- Changed loader color from orange to frost blue theme
- Color code updated from #214 (orange) to #117 (frost blue)

## Provider Updates

### Model Priority

- Added gpt-5-mini to default model priority list
- Improves model selection for OpenAI provider

## SDK Updates

### Configuration Types

- Updated generated SDK types to include usage_view keybind
- Maintains type safety across client-server boundary

---

**Summary**: This release improves TUI usability by adding search functionality to the usage dialog and fixing several UX issues including broken copy functionality, persistent streaming indicators, and PATH availability on first-time installation. The permission bypass warning has been simplified for better readability.
