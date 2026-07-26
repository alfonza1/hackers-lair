# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's **Report a vulnerability** flow on the repository Security tab:

https://github.com/alfonza1/hackers-lair/security/advisories/new

Include the affected version, operating system, reproduction steps, impact,
and any suggested mitigation. Do not include secrets, access tokens, or
unredacted local configuration.

The maintainer aims to:

- acknowledge a complete report within three business days;
- provide an initial severity assessment or request more information within
  seven business days;
- coordinate disclosure after a fix or mitigation is available.

Remediation timing depends on severity and release-channel constraints. The
reporter will receive status updates when the assessment or expected timeline
changes.

## Supported versions

The newest GitHub Release is supported. Security fixes may require upgrading
to the latest version because this project does not maintain parallel patch
branches for beta releases.

## Trust boundary

Hacker's Lair is a local process controller with intentionally powerful
capabilities:

- its service binds only to `127.0.0.1`;
- mutation requests require a per-launch random token;
- every request must use the exact bound `localhost` or `127.0.0.1` Host;
- desktop and CLI clients verify the service nonce, and the desktop also
  checks the recorded service process identity;
- it can start and stop commands explicitly configured by the local user.

The token and Host checks protect the localhost control surface; they do not
make user-supplied commands safe. A user who can edit the local configuration
can cause the app to execute commands with that user's operating-system
permissions. Configuration files must not contain secrets.

The only intended outbound request made by the desktop app is the public
GitHub release update check. The app does not include telemetry, analytics,
remote crash reporting, accounts, or a remote-control service.

## Release verification

Every release includes `checksums.txt` and GitHub build-provenance
attestations. Verify an artifact with:

```text
gh attestation verify <file> -R alfonza1/hackers-lair
```

Provenance is not Windows publisher signing and does not bypass SmartScreen.
