# mux

I saw tmux (only through WSL), CMUX, and other cool ways to manage and multitask in coding environments. I wanted the same for Windows.


## Features

- **Multi-project workspace**
- **Split panes**
- **Git worktree tasks**
- **Claude Code hooks**
- **Editor integration**
- **Dark and light themes**
- **Session persistence**
- **Socket RPC**

## Install

Download the latest release from the [releases page](https://github.com/adikuma/mux/releases).

> macOS and Linux builds coming soon. Currently Windows only.

### Hooks integration

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) - It is fully supported and the hooks configured automatically from Settings panel

> Planning on adding Codex and OpenCode support too.

### Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed breakdown of the codebase, data flow, and design decisions. (It might not be great, but I promis it will get better)

## Tech stack (This is new for me so don't roast me)

- Electron 35
- React 19
- TypeScript
- Zustand
- xterm.js + node-pty
- Tailwind CSS + CSS custom properties

## License

[AGPL-3.0-or-later](LICENSE)
