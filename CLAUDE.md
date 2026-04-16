# Takoyaki

See @README.md for the product overview, @docs/ARCHITECTURE.md for subsystem design, and @package.json for the available npm scripts.

## Workflow

- prefer targeted tests while iterating, then run `npm run check` before finishing a change set
- if you change ipc, update all three layers together: `src/main/index.ts`, `src/preload/index.ts`, and `src/renderer/types.ts`
- update `docs/CHANGELOG.md` for release facing changes
- `NOTES.md` is local only and stays out of git

## Code Style

- comments should be concise, lowercase, and use no em dashes
- keep imports at the top of the file
- use camelCase for values and functions, PascalCase for React components

## UI Rules

- use tokens from `src/renderer/design.ts` and css variables from `src/renderer/app.css`
- do not add hardcoded user visible colors
- window control icons stay at `10px`

## Architecture Rules

- the main process is the source of truth for workspace, terminal, review, and hook state
- the browser companion is a single main-process-managed `WebContentsView`, not a renderer webview
- `surfaceId` is the pane identity and `terminalId` is the pty identity
- pane labels may use Claude state, terminal title, and cwd heuristics, but never raw submitted terminal input
- `opensrc/` is available when dependency internals matter
