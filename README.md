# Arctic

> The multi-provider AI coding CLI. Unified limits, sessions, and tools in your terminal.

![Arctic CLI](./packages/web/public/arctic-logo.png)

Arctic is a high-performance, keyboard-driven terminal interface for AI coding. It unifies multiple providers (Anthropic, OpenAI, Google, etc.) into a single workflow with unified usage tracking, rate limit monitoring, and powerful session management.

## Features

- **Multi-Provider Support**: Switch seamlessly between Claude (Anthropic), GPT-4 (OpenAI/Copilot), Gemini (Google), and more without changing tools.
- **Unified Usage Tracking**: View rate limits, token usage, and costs across all providers in one place.
- **Git-Based Snapshots**: Automatic undo/redo for AI changes. Revert any session or tool execution safely.
- **Rich TUI**: A beautiful, low-latency terminal user interface built with SolidJS and OpenTUI.
- **Agent System**: Create custom agents with specialized prompts, tools, and permission scopes.
- **Local & Private**: Sessions and keys are stored locally. Direct connection to providers.

## Goal

Arctic was built to solve the fragmentation of AI coding tools. Developers often use multiple providers (Codex, Z.ai, Claude Code, Gemini, Antigravity) but lack a unified interface.

The goal of Arctic is to provide a single CLI that allows you to:
- **Run all providers from one place**: Seamlessly switch between models without changing tools.
- **Unified Limits**: See 5-hour and weekly usage limits together in a single view.
- **Consistent Workflow**: Use the same powerful TUI, shortcuts, and agent system regardless of the backend provider.

## Installation

```bash
curl -fsSL https://arcticli.com/install | sh
```

## Quick Start

1.  **Start the TUI**:
    ```bash
    arctic
    ```

2.  **Authenticate**:
    ```bash
    arctic auth login
    ```
    Follow the prompts to connect your preferred providers (Anthropic, GitHub Copilot, Google, etc.).

3.  **Run a Command**:
    ```bash
    arctic run "Analyze this repository and suggest improvements"
    ```

## Documentation

Full documentation is available at [https://arcticli.com/docs](https://arcticli.com/docs).

- [CLI Commands](https://arcticli.com/docs/cli/commands)
- [Configuration](https://arcticli.com/docs/cli/config)
- [Agent Guide](https://arcticli.com/docs/cli/agents)

## Development

Arctic is a monorepo built with **Bun**, **Turbo**, and **SolidJS**.

### Prerequisites

- [Bun](https://bun.sh) 1.3+

### Setup

```bash
# Install dependencies
bun install

# Start development server (TUI + Watch mode)
bun dev
```

### Build

```bash
bun run build
```

## License

MIT
