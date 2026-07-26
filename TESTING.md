# Production verification

This file separates checks that run in the repository from final checks that
require a clean virtual machine, public package approval, or the deployed
GitHub environment.

## Automated repository checks

Run on Windows:

```powershell
npm ci
npm run test:coverage
python -m pip install -r requirements-test.txt
python -m playwright install --only-shell chromium
npm run test:ui
npm run package
npm run smoke:package
npm run smoke:install
npm run make
```

- `test:coverage` covers API authorization, Host and content-type protection,
  identity handshakes, config backups and last-known-good behavior, project
  editing/discovery, truthful URLs, preferences, both platform parsers,
  onboarding prompts, static-site contracts, and release manifest generation.
- `smoke:package` launches the packaged executable with an isolated user-data
  directory, forcibly terminates its first child service, verifies Electron
  recovers with a new identity/PID, quits, and proves both service PIDs stopped.
- `smoke:install` serves a local release fixture, runs the stock PowerShell
  installer into a unique directory below `%LOCALAPPDATA%\Programs`, verifies
  SHA256-before-unblock behavior, runs the packaged `lair` CLI without Node,
  and exercises the verified uninstaller.
- `test:ui` drives the served page in headless Chromium at 1440x900 and
  900x620. It covers equal-path onboarding, live/dormant cards, truthful port
  chips, state-filtered palette commands, theme persistence, console errors,
  and minimum-window overflow.

CI runs `npm test` on `windows-latest` and `ubuntu-latest`; Windows also runs
both packaged smoke tests. Tagged builds run Forge on both operating systems,
normalize artifact names, generate checksums and Winget/Scoop manifests from
the final bytes, and publish one GitHub Release.

Local release-candidate verification on 2026-07-26 passed the full test suite,
JavaScript syntax checks, the packaged lifecycle, and the checksum installer
smoke test. The generated three-file Winget bundle also passed
`winget validate` with Windows Package Manager 1.29.280. The release workflow
uses the same manifest generator against the final installer bytes.

Published beta verification on 2026-07-26:

- main CI run `30195397941` passed Windows and Ubuntu tests, the Windows
  package/install smoke, and Linux ZIP/DEB/RPM creation plus lifecycle smoke;
- release run `30195506471` published the Windows installer/ZIP, Linux
  ZIP/tarball, DEB, RPM, and `checksums.txt`;
- every binary asset's GitHub-computed SHA256 matched the published checksum
  file, and the generated Winget bundle passed `winget validate`;
- the production PowerShell installer resolved `v2.1.0-beta.1`, verified its
  ZIP before extraction, installed the packaged executable and CLI into an
  isolated per-user directory, and the verified uninstaller removed it;
- Pages run `30195397928` deployed successfully. The live landing page, docs,
  installer, and 404 route returned the expected status, and each
  version-independent Linux release URL resolved to its published artifact.

## Static site checks

Serve the committed static directory without a generator:

```powershell
python -m http.server 8765 --directory site
```

Inspect the landing page and one docs page at desktop and narrow widths. Verify:

- keyboard focus is visible and the skip link works;
- Windows/Linux tabs change the command, and code copy controls respond;
- all commands remain readable with JavaScript disabled;
- reduced-motion mode shows the terminal's final content without typing;
- there are no download buttons, horizontal overflow, missing assets, or
  console errors;
- screenshots contain fictional sanitized targets only.

Lighthouse 13.4.1 was run in its default mobile mode with:

```powershell
npx --yes lighthouse@latest http://127.0.0.1:8765/ --quiet --chrome-flags="--headless=new --no-sandbox" --only-categories=performance,accessibility,best-practices,seo --output=json --output-path=out/lighthouse-index.json
npx --yes lighthouse@latest http://127.0.0.1:8765/docs/ --quiet --chrome-flags="--headless=new --no-sandbox" --only-categories=performance,accessibility,best-practices,seo --output=json --output-path=out/lighthouse-docs.json
```

The parsed results are also stored in `docs/lighthouse-summary.json`.

| Page | Performance | Accessibility | Best Practices | SEO |
|---|---:|---:|---:|---:|
| Landing | 100 | 100 | 100 | 100 |
| Installation docs | 100 | 100 | 100 | 100 |

On the second Windows run, Lighthouse wrote a complete report and then emitted
an `EPERM` while removing its temporary Chrome profile. The scores above come
from the successfully parsed report; no page audit failed.

The app UI was also exercised with empty and sanitized demo configurations at
1440x900 and the 900x620 minimum window size. Dormant/live card density,
truthful port chips, all five themes, the state-filtered command palette, and
the scrolling project editor rendered without console or layout errors.

## Manual clean-machine checks

These steps require disposable VMs and cannot be proven by a source checkout.
Record the VM image, release tag, and result in the release notes.

### Windows 11 with no Node.js

1. Confirm `node`, `npm`, and `lair` are absent.
2. Run the website's PowerShell command in stock Windows PowerShell.
3. Confirm the script downloads both release files, prints a matching SHA256,
   creates a Start menu shortcut, and launches without asking for elevation.
4. Open the wizard, scan a folder containing a dummy `package.json` with a
   harmless long-running start script, import it, and start/stop it.
5. Quit from the tray and verify ports 4949–4959 no longer contain the control
   service.
6. Re-run the install command and confirm it updates in place.
7. Run the uninstall one-liner. Confirm the app/server stop and test both
   **Keep data** and **Delete data** on separate snapshots.
8. Repeat through Winget after the community manifest is approved and through
   Scoop after the public bucket is created.
9. Record any SmartScreen or reputation dialog. Never bypass or disable it.
   Unsigned releases cannot truthfully guarantee reputation on every machine;
   use `SIGNING.md` before claiming otherwise.

### Linux VM with no Node.js

1. Install the `.deb` on Ubuntu/Debian and the `.rpm` on Fedora/RHEL.
2. Confirm the desktop launcher starts the bundled app and the Scripts tab is
   absent.
3. Scan and control dummy npm and Python projects.
4. Verify listeners through `ss`, then quit and confirm the control service
   exits.
5. Remove the package and the ownership-marked `~/.local/bin/lair` shim using
   the documented command. Confirm an unrelated file at that path is never
   overwritten or deleted.
6. Test retained user data, then delete
   `${XDG_CONFIG_HOME:-$HOME/.config}/HackersLair`.
7. Extract the tarball on a third clean snapshot and run both `HackersLair`
   and the bundled `lair` companion.

### Squirrel update lifecycle

This needs two public GitHub Releases, so it cannot be completed against a
single source checkout.

1. Install the older release through its Squirrel setup executable and confirm
   Doctor reports the `squirrel` channel.
2. Publish the newer release with its Squirrel `RELEASES` file and full nupkg,
   then launch the older app. The immediate GitHub update check should
   download it and show the non-blocking version banner with working release
   notes.
3. Start a harmless dummy target. Confirm **Restart to Apply** reports that
   managed targets must stop and does not restart the desktop.
4. Stop the target, apply the update, and confirm the app restarts on the
   newer version with the same user configuration.
5. Repeat from the Scoop and PowerShell portable channels. Confirm neither
   starts the internal updater; each shows its own passive upgrade command and
   Doctor reports the matching channel.

### Owner-controlled distribution channels

1. Confirm the public `hackerslairhq/scoop` bucket's **Update manifest**
   workflow succeeds against the latest release. It runs daily and can also be
   dispatched manually without a cross-repository token.
2. Submit the generated Winget folder using `distribution/WINGET.md`, then
   confirm the community validation and per-user install after approval.
