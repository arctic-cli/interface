# Arctic

Multi-provider terminal interface for AI coding.

![Arctic Demo](https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExcm5yMjgzMnR0MWZucWI1bDU5ZDFlZzNwcm0wN2s3YTd2NTIzcGdpeCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ulQQdgqAFI5sv9ONjs/giphy.gif)

## Why Arctic?

Arctic exists because existing tools weren't cutting it. I needed a way to connect multiple providers like Codex, Anthropic, Gemini, Z.ai and track usage limits in one place, but nothing offered that seamless integration.

I also wanted to benchmark models side-by-side (e.g., comparing Gemini vs. Claude on complex backend tasks). Other CLIs couldn't do this, and alternative GUI solutions felt buggy or bloated.

Frustrated by forced clipboard copying and rigid interfaces, I forked OpenCode, stripped away the unnecessary features, and simplified it into a custom TUI focused on what matters: **unified limits, multi-provider benchmarking, and total workflow control.**

## Installation

**macOS / Linux**

```bash
curl -fsSL https://arcticli.com/install | bash
```

**Windows**

```powershell
irm https://arcticli.com/install.ps1 | iex
```

## Supported Providers

**Coding Plan:**

- Anthropic (Claude Code)
- Codex
- Google (Gemini CLI)
- Antigravity
- Z.AI
- Github Copilot
- Kimi Coding
- Amp Code

**API:**

- OpenAI
- Anthropic
- Openrouter
- Chutes
- Perplexity
- Z.AI
- Ollama (local models)
- and way more...

## Quick Start

Start the interface:

```bash
arctic
```

## Development

```bash
bun install
bun dev
```

## Contributing

Arctic is a brand new project and we'd love your input! Whether you have ideas, want to report issues, or submit PRs - all contributions are very welcome.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

[Documentation](https://arcticli.com/docs) • [License](LICENSE)
