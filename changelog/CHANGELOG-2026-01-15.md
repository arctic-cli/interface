# Changelog - January 15, 2026

## Features

### User onboarding

- Add comprehensive onboarding flow for new TUI users
- Include 5-step setup process: welcome, theme, provider, agents, and commands
- Add --onboarding CLI flag to trigger onboarding manually
- Auto-trigger onboarding when no providers configured
- Store onboarding completion state to prevent re-triggering
- Add onboarding route type to navigation system

## TUI Improvements

### Usage dialog enhancements

- Hide token usage for connection-based providers that don't use token billing
- Apply to MiniMax with usage limits and Antigravity providers
- Improve display clarity for providers with alternative billing models

### Navigation and routing

- Add OnboardingRoute to route system with step-based navigation
- Extend Args context to support onboarding flag
- Add route match for onboarding in main app Switch

## Website Improvements

### Responsive design

- Improve padding consistency across mobile and desktop breakpoints
- Add conditional hiding of decorative elements on mobile
- Improve container padding structure for better responsive behavior
- Fix video element display with explicit block property

### Layout refinements

- Better nested padding structure for consistent spacing
- Improve section container structure for responsive design
- Better content centering and alignment

---

**Summary**: This release introduces a new user onboarding flow to help new users get started with Arctic by guiding them through theme selection, provider configuration, and feature introduction. The TUI usage dialog is improved to better handle connection-based providers with alternative billing models. The website receives responsive design improvements for a better mobile experience.
