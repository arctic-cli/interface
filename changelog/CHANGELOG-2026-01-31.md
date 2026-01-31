# Changelog - January 31, 2026

## Features

### Feedback Dialog for Power Users

- Add feedback dialog that appears after 2 sessions for engaged users
- Implement `SessionCounter` module to track when feedback should be shown
- Create interactive feedback dialog with category selection (Feature Request, Improvement, Praise, Other)
- Add API endpoint at `/api/feedback` to receive and store feedback submissions
- Include rate limiting (5 submissions per hour per IP) to prevent abuse
- Store feedback in Redis with 90-day expiration for analysis
- Add community links (GitHub Discussions, Discord) after successful submission

## Testing

### Session Counter Tests

- Add test suite for `SessionCounter` module
- Test feedback visibility logic at various session counts
- Verify feedback is only shown once per user

---

**Summary**: This release introduces a feedback collection system that prompts engaged users (2+ sessions) for input, helping improve Arctic based on real user experiences. The system includes categorization, rate limiting, and community integration.
