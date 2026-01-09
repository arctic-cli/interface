# Changelog - January 9, 2026

## Configuration Management

### OpenCode Config Auto-Import

- Added automatic detection of existing OpenCode configuration files
- Interactive prompt asks users to import OpenCode settings to Arctic
- Smart field detection only imports new settings not already in Arctic
- Supports importing theme, keybinds, TUI settings, MCP servers, commands, agents, and more
- Theme name mapping converts OpenCode theme names to Arctic equivalents
- Array fields merge without duplicates (plugins, enabled providers, etc.)
- Object fields merge preserving both configs (commands, agents, MCP servers)
- "Don't ask again" option saves user preference to storage
- Automatically runs on CLI startup when TTY is available
- Skips import prompt in CI environments and for help/version flags

### Configuration Import State Tracking

- Stores user import decision and timestamp in Arctic storage
- Tracks which fields were imported to avoid redundant prompts
- Supports "yes" and "no" decisions with persistent storage

## Documentation

### README Improvements

- Added dedicated "What is Arctic?" section explaining relationship to OpenCode
- Clarified Arctic as an OpenCode fork with extended provider support
- Listed key differentiators: extended provider support, built-in usage monitoring, ecosystem compatibility
- Added "Do I need to switch?" FAQ addressing migration decision
- Emphasized seamless switching with automatic config import

## Provider Support

### Anthropic OAuth Tool Name Mapping

- Added tool name mapping for Anthropic OAuth API compatibility
- Maps full tool names to truncated versions required by OAuth API (bash to bas_, read to rea_, etc.)
- Bidirectional mapping for request/response translation
- Integrated mapping into session processor and prompt generation
- Tool name resolution applied during tool call processing
- Ensures OAuth users can access all Arctic tools without API limitations

## Testing

### OpenCode Config Import Tests

- Added comprehensive test suite for config import functionality
- Tests array field merging without duplicates
- Tests object field merging preserving both configs
- Tests empty config handling (both empty Arctic and empty OpenCode)
- Tests theme name mapping from OpenCode to Arctic
- Tests config preservation when no new fields to import

---

**Summary**: This release adds seamless OpenCode configuration import to help users migrate to Arctic effortlessly. The system detects existing OpenCode configs, intelligently merges only new settings, and maps theme names appropriately. Documentation has been significantly improved to clarify Arctic's relationship to OpenCode and its key differentiators. Additionally, Anthropic OAuth users now benefit from proper tool name mapping to work around API limitations.
