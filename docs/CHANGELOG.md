# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

Each release must use an explicit version heading in the format `## [x.y.z] - YYYY-MM-DD`.

## [0.2.0] - 2026-04-20

### Added
- Browser companion panel with a titlebar toggle, docked native web view, basic navigation controls, and external-open handoff
- Shared browser url guardrails and unit coverage for embedded navigation rules

### Changed
- Mounted renderer terminals only for the active workspace so hidden workspaces stop paying the xterm rendering cost
- Kept the browser as a separate companion layer so it never owns pane layout state

### Fixed
- Preserved app shortcuts while the browser has focus and returned focus cleanly to the active terminal when the panel closes
- Kept browser loading and error feedback visible above the native web view host

## [0.1.4] - 2026-04-14

### Added
- Pane focus mode with a pane toolbar toggle and the `Ctrl+Shift+Enter` shortcut

### Fixed
- Kept pane focus mode aligned with real pane focus changes so shortcuts and visible panes stay in sync
- Preserved resized split ratios when entering and leaving pane focus mode on desktop

## [0.1.3] - 2026-04-12

### Changed
- Aligned child task rows with the same ambient hover and active wash used by parent project rows

### Fixed
- Added a little more separation between project and task cards so their hover surfaces no longer clash

## [0.1.2] - 2026-04-12

### Added
- Project identity accents in the sidebar with theme-aware ambient gradients
- Conservative pane auto labels based on Claude state, terminal title, and working directory
- Review navigation as a changed-file folder tree

### Changed
- Polished the review workspace with lighter header controls and cleaner diff gutters
- Refined sidebar identity treatment to feel calmer and more scan-friendly in both themes

### Fixed
- Removed raw command capture from pane metadata so terminal input is not exposed for labeling
- Refreshed release and contributor docs to match the shipped workspace-polish build

## [0.1.1] - 2026-04-12

### Added
- Per-pane terminal font zoom with keyboard and mouse shortcuts
- Richer Claude activity and approval state handling for plan and permission flows

### Changed
- Refactored the sidebar into focused components and hooks to keep the renderer structure easier to maintain
- Aligned the release metadata, website, and contributor docs with the shipped `v0.1.1` build

### Fixed
- Improved hook icon placement, scrollbar behavior, and pane toolbar recovery
- Increased app border contrast and made active pane highlighting more reliable
- Hardened workspace restore behavior and normalized direct-opened task worktrees under their parent project
- Made task removal safer on Windows and cleaned up stale task entries when the worktree is already gone

## [0.1.0] - 2026-04-07

### Added
- Multi-project workspaces
- Split panes
- Git worktree tasks
- Review mode
- Unified diff viewer
- Pinned projects
- Claude Code hooks
- Editor integration
- Dark and light themes
- Session persistence

### Changed
- Reset the public release history to a single clean `v0.1.0` starting point

### Fixed
- Improved terminal resizing, focus behavior, and scrolling on Windows
- Plain folders now open cleanly without git and can upgrade in place after `git init`
