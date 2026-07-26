# Versioning policy

Hacker's Lair uses Semantic Versioning for stable releases and SemVer
prerelease identifiers while the product is in beta.

## Public compatibility surfaces

The compatibility contract covers three surfaces:

- the project, scripts, and settings configuration schemas;
- the packaged `lair` command-line interface;
- the token-protected local HTTP API used by the packaged desktop and CLI.

## Major versions

A major version is required when an upgrade intentionally breaks a supported
configuration, removes or renames a CLI command or established exit behavior,
or changes/removes a local API route or response field without a compatibility
path.

Config changes that require users to edit their files manually are breaking.
When a config transformation can be performed safely and losslessly, an
ordered migration with a pre-migration backup may ship in a minor version.

## Minor versions

A minor version may add optional config fields, commands, routes, response
fields, discovery types, or UI capabilities. Readers must ignore unknown
fields so a newer config remains loadable by an older build. New fields need
safe defaults, schema documentation, and upgrade/downgrade tests.

The local API is private to one local installation, but additive API changes
still follow this policy because scripts may use it. Every mutation remains
token-protected and JSON-only.

## Patch versions

A patch version fixes behavior or security without deliberately changing the
documented contract. Tightening validation is a patch only when it rejects
input that was already invalid or unsafe; rejecting previously documented
input requires a major version or a migration and deprecation period.

## Deprecation

When practical, a behavior is documented as deprecated in at least one minor
release before removal. The changelog names affected config fields, CLI
commands, and API routes explicitly.
