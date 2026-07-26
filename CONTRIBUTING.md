# Contributing to Hacker's Lair

Thanks for improving a local-first developer tool. Keep changes focused,
offline-capable, and honest about the app's process-control trust boundary.

## Development setup

Install Node.js 22.12 or newer, then use the repository path. End-user
installers do not require Node; this section is only for contributors.

```powershell
git clone https://github.com/alfonza1/hackers-lair.git
Set-Location hackers-lair
npm ci
npm test
npm start
```

On Linux:

```bash
git clone https://github.com/alfonza1/hackers-lair.git
cd hackers-lair
npm ci
npm test
npm start
```

Electron Forge may require the native package tools documented by its DEB and
RPM makers. CI installs `fakeroot`, `rpm`, and `xvfb` on Ubuntu.

## Validation

Run the checks relevant to your change before opening a pull request:

```text
npm audit --omit=dev --audit-level=high
npm run test:coverage
npm run test:ui
npm run package
npm run smoke:package
```

Windows installer work also runs `npm run smoke:install`. Linux package work
runs `npm run make` and the packaged lifecycle under `xvfb-run`.

Do not commit `projects.json`, `scripts.json`, logs, tokens, backups, machine
paths, or screenshots containing personal project data.

## Coding conventions

- Keep platform-specific commands behind `lib/platform/`.
- Keep functions small, intention-revealing, and explicit about side effects.
- Preserve forward-compatible config loading: ignore unknown fields and never
  destroy fields an older build does not understand.
- Treat configuration writes as durable data changes: validate first, create a
  backup, then write atomically.
- Add tests for behavior and failure paths. Avoid tests that depend on a
  developer's real processes, ports, or home directory.
- Do not add telemetry, analytics, accounts, external CDNs, or runtime
  dependencies without a concrete offline product need.
- Update the docs and `CHANGELOG.md` when user-visible behavior changes.

## Proposing a new project or task type

Open a feature request before a large implementation. Describe:

1. the files or commands that identify the type;
2. the proposed start and graceful-stop commands on Windows and Linux;
3. how listening ports and readiness can be detected without running untrusted
   discovery commands;
4. a minimal sanitized fixture;
5. any platform-specific limitations.

Discovery must remain preview-only. It may read project metadata, but it must
not install dependencies, run discovered commands, or write configuration
until the user confirms the proposal.

Implement detection as a small proposal builder in
`lib/project-discovery.js`, add sanitized fixtures and tests, and update the
configuration and Getting Started docs.

## Pull requests

Use a focused branch and the pull request template. Explain the user-visible
outcome, security or persistence implications, and verification evidence.
Generated release assets and dependency directories do not belong in commits.

