# Contributing to Arctic

Thank you for your interest in contributing to Arctic! We welcome contributions from the community.

## Development Setup

Arctic is built with **Bun**. Please ensure you have [Bun 1.3+](https://bun.sh) installed.

1.  **Fork and Clone** the repository:

    ```bash
    git clone https://github.com/arctic-cli/cli.git arctic
    cd arctic
    ```

2.  **Install Dependencies**:

    ```bash
    bun install
    ```

3.  **Start Development**:
    To run the core CLI/TUI in development mode:
    ```bash
    bun dev
    ```
    This will launch the TUI and watch for changes in `packages/arctic`.

## Project Structure

This is a monorepo managed with [Turbo](https://turbo.build/).

- **`packages/arctic`**: The core CLI and TUI application (SolidJS + OpenTUI).
- **`packages/web`**: The documentation website (Next.js + Fumadocs).
- **`packages/sdk`**: Client SDKs.
- **`packages/plugin`**: Plugin system types and utilities.

## Code Style & Conventions

Please read our [Style Guide](./STYLE_GUIDE.md) before writing code. We enforce strict conventions to maintain codebase consistency.

**Key Rules:**

- Avoid `let`, use `const`.
- Avoid unnecessary destructuring.
- Keep logic in single functions where possible.
- Use Bun APIs (`Bun.file`, etc.) over Node.js equivalents.

## Testing

Run the test suite:

```bash
bun test
```

## Submitting Pull Requests

1.  Create a new branch for your feature or fix.
2.  Ensure your code follows the style guide.
3.  Add tests if applicable.
4.  Submit a PR with a clear description of the changes.

## License

By contributing, you agree that your contributions will be licensed under its MIT License.
