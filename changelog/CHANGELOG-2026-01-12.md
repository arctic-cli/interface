# Changelog - January 12, 2026

## New Features

### MiniMax Coding Plan Support

- Add MiniMax and MiniMax Coding Plan as new AI providers
- Support Anthropic-compatible API endpoints
- Add optional Group ID for usage tracking via platform.minimax.io
- New authentication dialog for API key and optional Group ID

## TUI Improvements

### Usage Limit Display

- Add colored usage indicators in sidebar (green >50%, yellow >20%, red <=15%)
- Display request quota with percentage and progress bar
- Show remaining time before reset
- Add usage limits to prompt status bar

### Provider Authentication

- Add minimax-coding-plan to provider list with priority level 6
- Add MiniMax description in auth command output

## Provider Integration

- Add MiniMax provider configuration with MiniMax-M2.1 model
- Add MiniMax Coding Plan provider with same model
- Implement usage limit fetching from MiniMax API
- Add MiniMax to supported usage providers list

## Bug Fixes

- Hide token usage and cost summary when MiniMax quota limits are displayed
- Adjust remaining percentage calculation for MiniMax (inverted: shows used%)
- Fix limit reached warning to only show when usage < 100%

---

**Summary**: Added MiniMax Coding Plan as a new AI provider with usage limits tracking and colored sidebar display. The implementation includes provider configuration, authentication UI, usage tracking via Group ID API, and visual indicators showing remaining quota with color-coded warnings.
