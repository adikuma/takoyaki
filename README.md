# Takoyaki

Takoyaki is a Windows-first terminal multiplexer for AI coding agents.
It brings multiple projects, split panes, git worktree tasks, Claude Code hooks, review tools, and editor actions into one desktop app.


## Features

- **Multi-project workspace**
- **Split panes**
- **Git worktree tasks**
- **Review mode**
- **Review file tree navigation**
- **Claude Code hooks**
- **Editor integration**
- **Per-pane terminal zoom**
- **Pane auto labels**
- **Project accents**
- **Dark and light themes**
- **Session persistence**
- **Socket RPC**

## Install

Download the latest release from the [releases page](https://github.com/adikuma/takoyaki/releases).

See [docs/CHANGELOG.md](docs/CHANGELOG.md) for release notes.

> macOS and Linux builds coming soon. Currently Windows only.

### Hooks integration

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) - fully supported, with hook installation and repair available from the Settings panel

### Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a detailed breakdown of the codebase, data flow, and design decisions.

## Tech stack

- Electron 41
- React 19
- TypeScript
- Zustand
- xterm.js + node-pty
- Tailwind CSS + CSS custom properties

## License

[AGPL-3.0-or-later](LICENSE)
