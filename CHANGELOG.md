# Changelog

All notable changes to Hacker's Lair are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](VERSIONING.md).

## [Unreleased]

### Added

- Added the first AI workflow maintenance foundation: an opt-in Skills privacy
  gate, schema-backed workflow settings, a capped local usage-event reader, and
  manual log compaction.
- Added reviewable Claude Code usage-hook setup with exact JSON copying,
  conflict-safe one-click installation, atomic writes, and timestamped backups.
- Added a machine-aware agent prompt that configures usage tracking with live
  paths and disappears once the hook is detected.
- Added Skills maintenance cards with eight-week usage history, cold and rewrite
  signals, deterministic lint and routing-overlap findings, effectiveness marks,
  and cached Git edit age.
- Added a local context-tax breakdown, lint-clean personal skill scaffolding,
  and backed-up archive/restore actions. Default and plugin skills remain
  read-only.
- Added a local friction log with recurrence grouping, three-strike skill
  nudges, and a zero-network skill-routing tester.
- Added a read-only Instructions view for known `AGENTS.md` and `CLAUDE.md`
  files with safe editor/reveal actions and explicit drift checks for missing
  paths and commands.
- Added a read-only Agent Ops inventory for user/project subagents, slash
  commands, MCP definitions, merged permission rules, and configured hooks.
  MCP environment values are excluded and no server is launched or probed.
- Added stale-content checks, explicit cached link validation, project coverage,
  Doctor workflow-link health, skill-repository publication state, and
  cross-harness skill parity.
- Added separately opt-in redacted session summaries, read-only memory age,
  local weekly workflow reports, and local workflow bundle export.
- Added safe `?view=` deep links for opening an enabled console panel directly.
- Added a machine-aware agent-assisted path to Add Project that appends targets
  while preserving the existing registry, alongside the manual editor.

### Changed

- New installs keep local Skills scanning disabled until the user opts in.
  Existing saved panel choices are preserved by the settings v4 migration.

### Fixed

- Kept the primary view tabs stationary by moving conditional view actions and
  Agent Ops filters into dedicated control rows beneath search.
- Open-in-editor on Windows now passes instruction paths directly to Explorer,
  so command metacharacters in a legitimate folder name are never interpreted.
- Skills-repository status is cached across rapid UI polls, and hook setup now
  exposes the privacy-safe workspace-instruction fallback beside its JSON.
- Personal Skills discovery now follows verified directory links, including
  Windows junctions, inside the configured shared skill directory.
- Skill linting now accepts folded YAML frontmatter descriptions instead of
  incorrectly reporting them as empty.
- One physical skill linked into multiple harness roots now renders once with
  combined harness labels instead of reporting a self-collision.

## [2.1.0-beta.7] - 2026-07-27

### Added

- Added Ultraviolet, a deep ink-and-lilac console theme, and Volt, a restrained
  graphite theme with an acid-lime signal color.

### Changed

- Replaced the Amber and Crimson presets. Existing preferences migrate to
  Ultraviolet and Volt respectively without changing density, motion, or font
  scale.

## [2.1.0-beta.6] - 2026-07-27

### Fixed

- Native dropdown menus now use theme-aware text and surface colors, keeping
  Settings options readable before hover across every included theme.

## [2.1.0-beta.5] - 2026-07-27

### Added

- Added independent Skills and Scripts panel switches to Settings and the
  command palette.

### Changed

- Skills is enabled by default and uses the current user's `.agents/skills`
  folder; existing settings are backed up before the one-time migration.
- The Windows-only Scripts panel is disabled by default and does not enumerate
  or launch scripts until explicitly enabled.

## [2.1.0-beta.4] - 2026-07-27

### Fixed

- Restored the compact gear icon for Settings without removing any settings
  controls or the Release notes action.

## [2.1.0-beta.3] - 2026-07-27

### Added

- Packaged portable, Scoop, and Linux installs now check the official GitHub
  releases feed hourly and show a quiet update badge when an update is
  available; installation remains user-initiated through the detected channel.

### Changed

- Restored the complete Settings panel with theme, density, motion, font scale,
  launch-on-startup, and release-note controls.
- Moved update commands into a focused dialog opened by the update badge, with
  one-click command copying.
- Target cards now show only the action valid for their current state, matching
  the compact Scripts and Port Signals controls.

### Fixed

- PowerShell installs now migrate retired `launcher.vbs` taskbar and desktop
  shortcuts to the packaged executable and remove the obsolete forced-startup
  shortcut after preserving backups.
- PowerShell installs started from an administrator terminal no longer leave an
  elevated tray process that blocks later normal-user launches.

## [2.1.0-beta.2] - 2026-07-26

### Added

- Channel-aware update notices and Squirrel-only automatic update downloads.
- GitHub build-provenance attestations and bundled third-party license notices.
- Backend supervision with bounded restart backoff, visible recovery state, and
  packaged recovery smoke coverage.
- Bounded component logs, runtime failure logs, storage reporting, and an
  in-app clear action.
- Headless Playwright coverage for empty, live, dormant, palette, theme, and
  minimum-window states.
- Project setup warnings that identify the application and PID already using a
  newly configured port before the project is saved.

### Changed

- Moved the public repository, Pages site, release URLs, updater, and install
  channels to the product-owned `hackerslairhq` organization.
- Runtime configuration now carries an ordered migration version.
- Release automation uses immutable action revisions and audits the full npm
  dependency tree.
- Desktop shutdown requests a graceful service flush before the forced-stop
  fallback.
- CI and release jobs now print built-in Node test coverage and run the same UI
  smoke before publishing packages.

## [2.1.0-beta.1] - 2026-07-26

### Added

- Self-contained Electron packages for Windows and Linux.
- Per-user Squirrel installer, portable archives, DEB and RPM packages.
- First-run workspace discovery, project editor, templates, JSON Schema, config
  backups, import/export, and the agent setup prompt.
- Token-protected localhost API, verified service identity, platform process
  adapters, Doctor reports, CLI companion, tray controls, and command palette.
- Static command-first website and complete installation documentation.
- Automated tests, package lifecycle smoke checks, release checksums, Winget
  manifests, Scoop manifests, and GitHub Pages deployment.

### Security

- Moved mutable user data out of the repository.
- Added Host validation, JSON-only mutations, restrictive CSP, origin-checked
  desktop IPC, action locks, and last-known-good config behavior.

[Unreleased]: https://github.com/hackerslairhq/desktop/compare/v2.1.0-beta.2...HEAD
[2.1.0-beta.2]: https://github.com/hackerslairhq/desktop/compare/v2.1.0-beta.1...v2.1.0-beta.2
[2.1.0-beta.1]: https://github.com/hackerslairhq/desktop/releases/tag/v2.1.0-beta.1
