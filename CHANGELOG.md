# Changelog

All notable changes to Hacker's Lair are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](VERSIONING.md).

## [Unreleased]

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
