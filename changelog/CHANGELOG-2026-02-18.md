# Changelog - February 18, 2026

## OpenCode Compatibility

### Plural Directory Names Support

- Removed invalid directory check that incorrectly flagged plural directory names as typos
- Updated command loading to support both `command/` and `commands/` directories
- Updated agent loading to support both `agent/` and `agents/` directories  
- Updated plugin loading to support both `plugin/` and `plugins/` directories
- Updated config export to include plural directory patterns
- Added test coverage for plural commands directory

## Bug Fixes

### Permission Precedence

- Fixed agent permission merge order to prioritize project-level permissions over global agent-specific permissions
- Ensures user project config correctly overrides global config settings

### Stats Dialog

- Added error message display in stats dialog when loading fails
- Improves visibility of stats loading errors for better debugging

### Pricing Tests

- Fixed flaky pricing test for fallback models
- Test now verifies positive cost calculation instead of exact value
- Makes test resilient to pricing changes from models.dev API

---

**Summary**: This release improves OpenCode compatibility by supporting plural directory names (commands, agents, plugins), fixes permission precedence to respect project-level config, adds better error handling for stats loading, and stabilizes pricing tests against API changes.
