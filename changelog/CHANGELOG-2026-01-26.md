# Changelog - January 26, 2026

## Bug Fixes

### GitHub Copilot multi-connection auth fix

- Fix GitHub Copilot connections showing same account after restart
- Remove aggressive fallback logic in usage fetcher that caused auth sharing
- Ensure each connection uses its own dedicated auth credentials
- Prevent `github-copilot:connection` from falling back to `github-copilot` auth

**Issue**: When multiple GitHub Copilot connections were configured (e.g., `github-copilot` and `github-copilot:indo`), both would show the same username and usage limits after restarting Arctic.

**Root Cause**: The `fetchGithubCopilotUsageWrapper` function had fallback logic that would use the base `github-copilot` auth if a connection-specific auth wasn't found. This caused connection-specific providers to incorrectly use the base provider's credentials.

**Fix**: Removed the fallback logic entirely. Each provider connection now strictly uses its own auth entry, and throws a clear error if the auth is missing instead of silently falling back to a different account.

---

**Summary**: Fixed a critical bug where multiple GitHub Copilot connections would share the same account credentials after restart, ensuring each connection maintains its own separate authentication.
