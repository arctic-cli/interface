# Changelog - February 11, 2026

## Documentation

### Comprehensive Docs Overhaul

- Expand features page with detailed multi-provider architecture overview
- Add 130+ provider listings with categorization (coding plans vs API providers)
- Document skills system with examples and use cases
- Rewrite providers page with OAuth flows, multiple accounts, and custom providers
- Expand tools documentation with detailed parameter descriptions
- Add skills page documenting reusable prompt templates
- Update meta.json navigation to include skills and reorganize sections
- Fix authentication page link to config documentation

## TUI Improvements

### Usage Dialog Navigation

- Add up/down arrow buttons (▲/▼) for switching between providers
- Support keyboard navigation with ↑/↓ keys for provider selection
- Update help text to reflect new navigation shortcuts
- Refactor navigation logic into reusable `navigateProvider` function

## Bug Fixes

### Pricing

- Add lowercase `k2p5` to fallback pricing to fix Kimi K2.5 zero-cost issue
- Models.dev has `k2p5` with zero cost for kimi-for-coding provider
- Fallback pricing now correctly returns `{ input: 0.6, output: 3, cacheRead: 0.1 }`
- Add tests for lowercase k2p5 and kimi-for-coding/k2p5 model lookups

### Auth & OAuth

- Improve error messages for OAuth flows across providers
- Better handling of token refresh failures

---

**Summary**: This release delivers a major documentation overhaul with comprehensive provider listings and skills documentation, improves TUX with arrow navigation in the usage dialog, and fixes the Kimi K2.5 pricing issue caused by case-sensitive model ID matching.
