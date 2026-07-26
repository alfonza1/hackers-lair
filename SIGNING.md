# Code signing

Hacker's Lair release packages are currently unsigned. The release workflow
publishes SHA256 checksums, but checksums do not establish a trusted Windows
publisher identity and must not be described as code signing.

The Forge configuration is already conditional. Enabling trusted Windows
signing requires no source change:

1. Obtain a trusted code-signing certificate and export it as a password-
   protected PFX. Do not use a self-signed certificate for public releases.
2. Base64-encode the PFX without line breaks.
3. Add these GitHub Actions repository secrets:
   - `WINDOWS_SIGN_CERTIFICATE_BASE64`
   - `WINDOWS_SIGN_CERTIFICATE_PASSWORD`
4. Push the next version tag.

The Windows build job writes the certificate only to the runner's temporary
directory. Electron Packager signs the application executables and the
Squirrel maker signs the installer using the same identity. When the secrets
are absent, the job explicitly reports that it is producing unsigned
checksum-published artifacts.

Before calling a release signed, inspect the final GitHub Release artifacts:

```powershell
Get-AuthenticodeSignature .\HackersLair-<version>-Setup.exe | Format-List
```

The status must be `Valid`, the subject must match the intended publisher, and
the signature must use a trusted timestamp. Also run the clean-VM checks in
`TESTING.md`; signing changes Windows reputation behavior but does not replace
installer, update, or checksum testing.
