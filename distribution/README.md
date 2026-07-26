# Distribution manifests

`scripts/finalize-release-assets.js` writes the release-specific Winget and
Scoop manifests here from the hashes of the final packaged artifacts. The
release workflow performs that generation after both operating-system build
jobs finish.

- `winget/manifests/` is copied into a branch based on
  `microsoft/winget-pkgs` for the owner’s manual community PR.
- `scoop/hackerslair.json` matches the public `hackerslairhq/scoop` bucket.
  That bucket also refreshes itself from the latest release every day and on
  demand, so it needs no cross-repository access token.

Never hand-copy a checksum from an earlier build. Regenerate both manifests
from the exact release assets.
