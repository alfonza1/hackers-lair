# Submit the Winget manifest

The tagged release workflow generates a complete manifest bundle from the
SHA256 of the final Squirrel installer. The package identifier is:

```text
Alfonza1.HackersLair
```

After `v2.1.0-beta.1` is published:

1. Download the `package-channel-manifests` artifact from the successful
   Release workflow run.
2. Fork `microsoft/winget-pkgs` and create a branch such as
   `Alfonza1.HackersLair-2.1.0-beta.1`.
3. Copy the generated folder
   `winget/manifests/a/Alfonza1/HackersLair/2.1.0-beta.1` into the same path in
   the fork.
4. From a current Windows Package Manager installation, run:

   ```powershell
   winget validate .\manifests\a\Alfonza1\HackersLair\2.1.0-beta.1
   winget install --manifest .\manifests\a\Alfonza1\HackersLair\2.1.0-beta.1
   ```

5. Confirm the per-user install, Start menu shortcut, first launch, upgrade,
   and uninstall-data prompt.
6. Open the community pull request. Do not edit the generated installer SHA or
   point the manifest at a different artifact.

Microsoft's repository validation and reviewer approval are external manual
steps. Until approval, the website keeps the checksum-verifying PowerShell
channel visible next to Winget.
