# Takoyaki

Electron terminal multiplexer for AI coding agents. React renderer, node-pty terminals, zustand state, CSS variable theming.

## Directory Structure

```
src/
├── main/               # node.js main process (source of truth)
│   ├── terminal.ts     # node-pty wrapper, CWD tracking via OSC
│   ├── workspace.ts    # project state, pane tree, session persistence
│   ├── editor.ts       # windows editor launching and default editor preference
│   ├── hooks.ts        # claude code hook installer (Stop, StopFailure, UserPromptSubmit)
│   ├── rpc.ts          # JSON-RPC 2.0 handler for external tools
│   └── socket-server.ts # TCP socket on 127.0.0.1:PORT
├── preload/
│   └── index.ts        # IPC bridge via contextBridge (window.takoyaki)
└── renderer/
    ├── App.tsx          # root layout, IPC listeners, toast
    ├── Sidebar.tsx      # project list, smart collapse, theme toggle
    ├── Terminal.tsx      # xterm.js component
    ├── Settings.tsx     # hooks config, shortcuts reference
    ├── Titlebar.tsx     # custom titlebar with window controls
    ├── Tooltip.tsx      # custom tooltip, zero dependencies
    ├── store.ts         # zustand store, all UI state
    ├── design.ts        # design tokens (colors, fonts, sizes, buttons)
    └── app.css          # CSS variables for dark/light themes, animations
```

## Common Commands

```bash
npm run dev           # start electron in dev mode
npm run build         # build for production
npm run package:win   # build windows installer (output in release/)
npm run test          # run unit tests
npm run lint          # eslint check
npm run lint:fix      # eslint auto-fix
npm run format        # prettier format all source files
npm run format:check  # prettier check (no write)
npm run typecheck     # tsc --noEmit on both tsconfigs
npm run check         # format + lint + typecheck + test (full gate)
```

## Quality Gate

Always run `npm run check` before committing. This runs format check, lint, typecheck, and tests in sequence. All four must pass.

When editing source files, run the relevant checks before considering work done:

1. `npm run format` to auto-format changed files
2. `npm run lint:fix` to auto-fix lint issues
3. `npm run test` to verify nothing broke

Do not commit code that has lint errors. Warnings in test files (e.g. `any` in mocks) are acceptable.

## Code Conventions

- All comments lowercase, no hyphens or em dashes
- No underscore-prefixed variables or functions
- Imports at top of file, never inline
- camelCase for variables and functions, PascalCase for components
- Use `npm` (not pnpm)
- Single-line commit messages: `type: description` (feat, fix, chore, test, docs)
- Update `docs/CHANGELOG.md` for every release-facing change
- Keep changelog entries short and versioned: `## [x.y.z] - YYYY-MM-DD`, then compact bullets under `Added`, `Changed`, or `Fixed`
- After each meaningful implementation, update the local root `NOTES.md` with the date, decision, learning, and any important follow up
- Keep `NOTES.md` gitignored and local only. It is our running implementation memory and should not be committed

## Design System Rules

All themed colors use CSS variables from `app.css`. Never use hardcoded hex or Tailwind `text-stone-*` classes for user-visible content.

```typescript
// correct
style={{ color: colors.textPrimary }}
style={{ background: colors.bgCard }}
style={{ borderBottom: `1px solid ${colors.borderSubtle}` }}

// wrong - will break in light mode
className="text-stone-300"
style={{ color: '#78716c' }}
style={{ background: 'rgba(255,255,255,0.04)' }}
```

**Icons**: `sizes.iconSm` (13px) for inline, `sizes.iconBase` (15px) for primary. Window controls stay at 10px.

**Fonts**: DM Sans bundled locally in `src/renderer/assets/fonts/`. Monospace via system fallback chain in `fonts.mono`.

**Buttons**: Use `button.base`, `button.hover`, `button.active` tokens from `design.ts`. Apply via `Object.assign(e.currentTarget.style, button.hover)` on mouse events.

## Key Architecture Decisions

- **Surface ID vs Terminal ID**: each pane has a surfaceId (stable, used in hooks) and terminalId (internal, for node-pty). `TAKOYAKI_SURFACE_ID` env var is set in each PTY so hooks report back which pane triggered them.
- **Status flow**: hook fires in Claude Code -> `takoyaki-notify.js` sends JSON-RPC `status.update` -> main process stores in map -> broadcasts to renderer -> sidebar shows glyph.
- **Editor flow**: projects and tasks open directly in the configured editor from the sidebar. The default editor is stored under `~/.takoyaki/preferences.json`.
- **Activity tracking**: keyboard input timestamps per workspace. Sidebar collapses projects with no input for 1 hour and no agent activity.
- **Theming**: CSS variables on `:root` (dark default), `[data-theme="light"]` override. Terminal theme is separate (xterm doesn't support CSS vars) - `getTerminalTheme(mode)` returns the right object.

## Storage Locations

- `~/.takoyaki/state.json` - workspace layout persistence
- `~/.takoyaki/bin/takoyaki-notify.js` - hook notification script
- `~/.takoyaki/socket_addr` - TCP socket address for external tools
- `~/.claude/settings.json` - hook registration (modified by installer)

## Testing

Tests are in `src/__tests__/`. Run with `npm run test`. Tests cover workspace management, RPC protocol, worktree recovery, sidebar logic, and hook integration. Use `vitest` with Node environment.

## Workflow for New Features

1. Check if the feature touches main process, renderer, or both
2. For IPC: add handler in `main/index.ts`, bridge in `preload/index.ts`, type in `renderer/types.ts`
3. For UI: use design tokens from `design.ts`, never hardcode colors
4. For state: add to zustand store in `store.ts`, keep mutations through `window.takoyaki` IPC
5. Test both dark and light modes
