<p align="center">
  <img src="https://www.usearctic.sh/arctic-logo.png" alt="Arctic logo" width="200">
</p>
<p align="center">The open source AI coding agent with usage tracking.</p>
<p align="center">
<a href="https://discord.gg/B4HqXxNynG"><img alt="Discord" src="https://img.shields.io/badge/discord-join-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
<a href="https://github.com/arctic-cli/interface"><img alt="GitHub" src="https://img.shields.io/github/stars/arctic-cli/interface?style=flat-square" /></a>
</p>

[![Arctic Terminal UI](https://www.usearctic.sh/session_interface.png)](https://usearctic.sh)

## What is Arctic?

Arctic is an open-source fork of OpenCode, built to add native support for multiple AI coding plans and real-time usage tracking.

**Why Arctic exists:**

- **Extended provider support**: Native integration with Claude Code, Codex, Antigravity, Gemini CLI, GitHub Copilot, Z.AI, Kimi, Amp Code, and Qwen Code
- **Built-in usage monitoring**: See your quota limits, requests, and tokens directly in the TUI for all supported coding plans
- **Same ecosystem**: Arctic is fully compatible with OpenCode's configuration system and automatically imports your existing OpenCode settings when you switch

**Do I need to switch?**  
Yes, to see usage statistics and limits for your AI coding plans, you'll need to use Arctic. Since it's an OpenCode fork, switching is seamless, your custom commands, agents, and MCP servers work immediately.

## Get Started

```bash
curl -fsSL https://usearctic.sh/install | bash
arctic
```

You're set.

## Why Arctic?

**Know your usage without the guesswork.**

Arctic shows real-time usage for every AI coding plan you use: Claude Code, Codex, Gemini, Antigravity, and more. Track requests, tokens, and quotas in one place.

**Move between providers smoothly.**

Keep one conversation while switching models. Compare Claude vs Gemini on the same task without starting over.

**Keep your setup simple and local.**

Arctic runs on your machine and connects directly to your AI provider.

## Works With Everything

Arctic supports every major AI coding plan and API:

**Coding Plans:** Claude Code • Codex • Gemini CLI • Antigravity • GitHub Copilot • Z.AI • Kimi • Amp Code

**API Providers:** OpenAI • Anthropic • Google • Perplexity • Openrouter • Ollama • and more

[View all providers →](https://usearctic.sh/docs/providers)

## Usage Screenshots

Anthropic:

![Anthropic Usage](https://www.usearctic.sh/cc_usage.png)

Codex:

![Codex Usage](https://www.usearctic.sh/codex_usage.png)

Antigravity:

![Antigravity Usage](https://www.usearctic.sh/antigravity_usage.png)

GitHub Copilot:

![GitHub Copilot Usage](https://www.usearctic.sh/copilot_usage.png)

Z.AI:

![Z.AI Usage](https://www.usearctic.sh/zai_usage.png)

Note: Some providers (like Qwen Code, Kimi for Coding or MiniMax) are not shown here, but their usage views are available in the TUI.

## Development

```bash
bun install
bun dev
```

## Contributing

Arctic is open source and we'd love your input. Whether you have ideas, want to report issues, or submit PRs, all contributions are welcome.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

**If Arctic saved you time or stress, a short message or issue saying how you use it helps a lot.**

## FAQ

**What if I come from Claude Code?**

> Arctic automatically imports your Claude Code setup. Custom commands, subagents from `~/.claude/agents/`, and MCP server configurations work out of the box. Arctic reads Claude's configuration but doesn't modify it, so you can use both side by side.

**What is different from OpenCode?**

> Arctic supports 8+ coding plans (Claude Code, Codex, Gemini CLI, Antigravity, GitHub Copilot, Z.AI, Kimi, Amp Code) with built-in usage tracking and quota monitoring. Switch between Antigravity, Claude Code, and Codex efficiently and fast with real-time limit tracking for each provider. Lightweight CLI/TUI only with no desktop app or web interface, optimized for terminal-first users.

**Does Arctic store my data or send it to external servers?**

> No. Arctic runs entirely on your machine and connects directly to your AI provider. All conversations and data stay local. Arctic only communicates with the AI providers you authenticate with. The install script tracks anonymous installation counts (OS and architecture only) for project statistics, but no personal data or usage information is collected.

**Does Arctic collect telemetry?**

> Arctic temporarily collects anonymous usage telemetry to understand how users interact with the tool. This helps us improve the experience and prioritize features. No personal data, code, or conversations are collected. You can opt out at any time by running `arctic telemetry disable`.

**Can I use Arctic with my own API keys?**

> Yes. Arctic supports direct API key usage for OpenAI, Anthropic, Google, Perplexity, Openrouter, Ollama, and more. Just authenticate with your preferred provider.

**How do I switch between different AI models?**

> Press `ctrl+p` to open the command palette, then select "Switch model". You can switch models mid-conversation without losing context.

**Does Arctic work offline?**

> Arctic requires internet to connect to AI providers. If you use a local provider like Ollama, you can use Arctic with local models without internet.

**Can I use Arctic in my existing projects?**

> Yes. Arctic works in any directory. Just run `arctic` in your project folder and it will use that as the working directory.

**How do I customize keybindings?**

> Create an `arctic.json` or `arctic.jsonc` file in `~/.config/arctic/` (global) or `<project>/.arctic/` (project-specific). See [configuration docs](https://usearctic.sh/docs/cli/config) for details.

**What happens if I hit my usage limits?**

> Arctic shows usage warnings when you approach limits (below 15% remaining). The TUI displays real-time usage so you can monitor and switch providers before hitting hard limits.

&ensp;

## Learn More

[Documentation](https://usearctic.sh/docs) • [GitHub](https://github.com/arctic-cli/interface) • [Discord](https://discord.gg/B4HqXxNynG) • [License](LICENSE)
