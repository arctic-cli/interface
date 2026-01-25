# Changelog - January 25, 2026

## Bug Fixes

### Provider dialog improvements

- Fix multi-connection provider dialog closing instantly after user action
- Make dialog callback functions properly async and await them before closing
- Ensure user actions complete before dialog dismisses
- Fix prompt component alignment issues

### Rate limit handling enhancements

- Improve Gemini rate limit detection and retry behavior
- Parse Google-specific error messages to extract accurate retry delays
- Always retry rate limit errors regardless of isRetryable flag
- Add support for Google quota reset timing from error messages
- Increase maximum retries from 0 to 20 for better recovery
- Add dedicated MAX_RATE_LIMIT_RETRIES constant

### Abort handling improvements

- Fix loader persisting after user cancels conversation
- Detect abort errors and set session status to idle immediately
- Ensure assistant message is properly finalized on abort
- Prevent infinite loops when user cancels during processing

## Code Quality

### Session management improvements

- Reorganize imports for consistency across session files
- Increase compaction maxRetries from 0 to 3 for better reliability
- Add clear constants for retry thresholds

---

**Summary**: This release fixes critical UX issues including provider dialogs closing unexpectedly, loaders persisting after cancellation, and conversations stopping on Gemini rate limits. Enhanced retry logic now properly handles Google's specific error format with accurate delay extraction.
