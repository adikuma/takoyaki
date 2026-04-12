# Takoyaki

Electron terminal multiplexer for AI coding agents. React renderer, node-pty terminals, zustand state, CSS variable theming.

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types or interface.

### Fetching Additional Source Code

```bash
npx opensrc <package>           # npm package
npx opensrc pypi:<package>      # python package
npx opensrc crates:<package>    # rust crate
npx opensrc <owner>/<repo>      # github repo
```

## Directory Structure

```text
src/
  main/                 # node.js main process and source of truth
    terminal.ts         # node-pty wrapper, ordered terminal events, cwd and title tracking
    workspace.ts        # project state, pane tree, session persistence
    editor.ts           # windows editor launching and default editor preference
    hooks.ts            # claude code hook installer, diagnostics, and repair flow
    review.ts           # git-backed review snapshots and file patches
    rpc.ts              # json-rpc 2.0 handler for external tools
    socket-server.ts    # tcp socket on 127.0.0.1:port
  preload/
    index.ts            # ipc bridge via contextBridge as window.takoyaki
  renderer/
    App.tsx             # root layout, ipc listeners, terminal stage, toasts
    Sidebar.tsx         # sidebar shell and controller wiring
    sidebar/            # project tree, palette, modals, and sidebar hooks
    Terminal.tsx        # xterm.js component and pane chrome
    Review.tsx          # review shell and diff pane
    ReviewTree.tsx      # changed-file folder tree
    Settings.tsx        # hooks config and shortcuts reference
    Titlebar.tsx        # custom titlebar with window controls
    Tooltip.tsx         # custom tooltip, zero dependencies
    store.ts            # zustand store and ui state
    design.ts           # design tokens
    app.css             # css variables for dark and light themes
```

## Common Commands

```bash
npm run dev
npm run build
npm run package:win
npm run test
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run typecheck
npm run check
```

## Quality Gate

Always run `npm run check` before committing. This runs format check, lint, typecheck, and tests in sequence. All four must pass.

When editing source files, run the relevant checks before considering work done:

1. `npm run format` to auto-format changed files
2. `npm run lint:fix` to auto-fix lint issues
3. `npm run test` to verify nothing broke

Do not commit code that has lint errors. Warnings in test files are acceptable.

## Code Conventions

- All comments lowercase, no hyphens or em dashes
- No underscore-prefixed variables or functions
- Imports at top of file, never inline
- camelCase for variables and functions, PascalCase for components
- Use `npm` not `pnpm`
- Single-line commit messages: `type: description`
- Update `docs/CHANGELOG.md` for every release-facing change
- Keep changelog entries short and versioned as `## [x.y.z] - YYYY-MM-DD`
- After each meaningful implementation, update the local root `NOTES.md`
- Keep `NOTES.md` gitignored and local only

## Design System Rules

All themed colors use CSS variables from `app.css`. Never use hardcoded hex or Tailwind `text-stone-*` classes for user-visible content.

```typescript
// correct
style={{ color: colors.textPrimary }}
style={{ background: colors.bgCard }}
style={{ borderBottom: `1px solid ${colors.borderSubtle}` }}

// wrong
className="text-stone-300"
style={{ color: '#78716c' }}
style={{ background: 'rgba(255,255,255,0.04)' }}
```

**Icons**: `sizes.iconSm` for inline, `sizes.iconBase` for primary. Window controls stay at 10px.

**Fonts**: DM Sans bundled locally in `src/renderer/assets/fonts/`. Monospace via system fallback chain in `fonts.mono`.

**Buttons**: Use `button.base`, `button.hover`, and `button.active` tokens from `design.ts`.

## Key Architecture Decisions

- **Surface id vs terminal id**: each pane has a `surfaceId` used in hooks and focus state, and a `terminalId` used internally for node-pty.
- **Status flow**: Claude hook events go through `takoyaki-notify.js`, hit `status.update`, and are reduced into activity and attention state before the renderer updates.
- **Pane labels**: pane identity comes from Claude state, terminal title, and cwd heuristics. Do not infer identity from raw submitted terminal input.
- **Editor flow**: projects and tasks open directly in the configured editor from the sidebar. The default editor is stored under `~/.takoyaki/preferences.json`.
- **Activity tracking**: keyboard input timestamps per workspace. Sidebar can use that to sort and collapse quieter projects.
- **Theming**: CSS variables on `:root` drive the app theme, while `getTerminalTheme(mode)` handles xterm separately.

## Storage Locations

- `~/.takoyaki/state.json` for workspace layout persistence
- `~/.takoyaki/preferences.json` for the default editor and pinned projects
- `~/.takoyaki/bin/takoyaki-notify.js` for the hook notification script
- `~/.takoyaki/socket_addr` for the tcp socket address
- `~/.claude/settings.json` for hook registration
- `project/.git/takoyaki-tasks.json` for managed task metadata

## Testing

Tests live in `src/__tests__/`. Run them with `npm run test`. Coverage focuses on workspace management, rpc, worktree recovery, review flows, sidebar logic, hooks, and terminal behavior through vitest in a node environment.

## Workflow for New Features

1. Check if the feature touches main process, renderer, or both
2. For ipc, add the handler in `main/index.ts`, bridge in `preload/index.ts`, and matching renderer types
3. For ui, use design tokens from `design.ts` and shared pieces in `renderer/sidebar/` when the work belongs in the sidebar
4. For state, keep mutations flowing through `window.takoyaki` and store snapshots in `store.ts`
5. Test both dark and light modes
