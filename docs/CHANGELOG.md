# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

Each release must use an explicit version heading in the format `## [x.y.z] - YYYY-MM-DD`.

## [0.3.0] - 2026-04-05

### Added
- Pinned projects

### Changed
- I preferred stability over trying to fix every terminal quirk at once and will keep refining it as testing continues

### Fixed
- Reduced terminal glitches during split close and pane switching
- Plain folders now open cleanly without git and show no git state in the sidebar

## [0.2.0] - 2026-04-05

### Added
- Review mode
- Unified diff viewer
- Review focus mode

### Changed
- Renamed `Mux` to `Takoyaki`
- Updated installer naming
- Removed explicit `any` usage
- Refined review UI

### Fixed
- Terminal buffer preservation on pane resize
- Windows terminal resize behavior

## [0.1.1] - 2026-04-05

### Fixed
- Bug fixes

## [0.1.0] - 2026-04-04

### Added
- Initial Windows release
- Multi-project workspaces
- Split panes
- Git worktree tasks
- Claude Code hooks
- Editor integration
- Themes
- Session persistence
