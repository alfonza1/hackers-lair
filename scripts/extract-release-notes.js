#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const INSTALL_SECTION = [
  '---',
  '',
  '### Install',
  '',
  'The commands below verify the published SHA256 checksum before installing.',
  'Downloading an asset from this page directly does not.',
  '',
  '**Windows**',
  '',
  '```powershell',
  'irm https://hackerslairhq.github.io/desktop/install.ps1 | iex',
  '```',
  '',
  '**Linux and Scoop:** see the [installation guide](https://hackerslairhq.github.io/desktop/docs/).',
].join('\n');

function releaseNotes(markdown, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## \\[${escapedVersion}\\](?: - [^\\r\\n]+)?\\r?$`, 'm');
  const match = heading.exec(markdown);
  if (!match) throw new Error(`CHANGELOG.md has no release section for ${version}.`);
  const remainder = markdown.slice(match.index + match[0].length).replace(/^\r?\n/, '');
  const boundary = remainder.search(/^(?:## \[|\[[^\r\n]+\]:)/m);
  const notes = (boundary === -1 ? remainder : remainder.slice(0, boundary)).trim();
  if (!notes) throw new Error(`CHANGELOG.md release section for ${version} is empty.`);
  return `${notes}\n`;
}

function publishedReleaseNotes(markdown, version) {
  return `${releaseNotes(markdown, version).trimEnd()}\n\n${INSTALL_SECTION}\n`;
}

function main(argv = process.argv.slice(2)) {
  const version = String(argv[0] || '').replace(/^v/, '');
  const outputFile = argv[1] || path.join(process.cwd(), 'release-notes.md');
  if (!version) throw new Error('Usage: extract-release-notes.js <version> [output-file]');
  const changelog = fs.readFileSync(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8');
  fs.writeFileSync(outputFile, publishedReleaseNotes(changelog, version), 'utf8');
  console.log(`Extracted ${version} release notes to ${outputFile}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { publishedReleaseNotes, releaseNotes };
