# Changelog

All notable changes to Hacker's Lair are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](VERSIONING.md).

## [Unreleased]

### Added

- Channel-aware update notices and Squirrel-only automatic update downloads.
- GitHub build-provenance attestations and bundled third-party license notices.
- Backend supervision with bounded restart backoff, visible recovery state, and
  packaged recovery smoke coverage.
- Bounded component logs, runtime failure logs, storage reporting, and an
  in-app clear action.

### Changed

- Runtime configuration now carries an ordered migration version.
- Release automation uses immutable action revisions and audits production
  dependencies.
- Desktop shutdown requests a graceful service flush before the forced-stop
  fallback.

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

[Unreleased]: https://github.com/alfonza1/hackers-lair/compare/v2.1.0-beta.1...HEAD
[2.1.0-beta.1]: https://github.com/alfonza1/hackers-lair/releases/tag/v2.1.0-beta.1
