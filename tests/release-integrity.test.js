const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const workflowDirectory = path.join(root, '.github', 'workflows');
const fullCommitSha = /^[0-9a-f]{40}$/;

test('GitHub Actions are pinned and release artifacts receive provenance', () => {
  const workflowFiles = fs.readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/i.test(name));
  for (const workflowFile of workflowFiles) {
    const workflow = fs.readFileSync(path.join(workflowDirectory, workflowFile), 'utf8');
    for (const match of workflow.matchAll(/uses:\s*[^@\s]+@([^\s#]+)/g)) {
      assert.match(match[1], fullCommitSha, `${workflowFile}: ${match[0]}`);
    }
  }

  const release = fs.readFileSync(path.join(workflowDirectory, 'release.yml'), 'utf8');
  assert.match(release, /actions\/attest-build-provenance@[0-9a-f]{40}/);
  assert.match(release, /subject-path:\s*release-assets\/\*/);
  assert.match(release, /npm audit --omit=dev --audit-level=high/g);
  assert.match(release, /RELEASES/);
  assert.match(release, /\*-full\.nupkg/);
});

test('Dependabot covers npm and workflow dependencies every week', () => {
  const dependabot = fs.readFileSync(
    path.join(root, '.github', 'dependabot.yml'),
    'utf8',
  );
  assert.match(dependabot, /package-ecosystem:\s*"?npm"?/);
  assert.match(dependabot, /package-ecosystem:\s*"?github-actions"?/);
  assert.equal((dependabot.match(/interval:\s*"?weekly"?/g) || []).length, 2);
});

test('third-party notices cover every bundled production package', () => {
  const { generateThirdPartyNotices, productionPackages } = require('../scripts/generate-third-party-notices');
  const notices = generateThirdPartyNotices();
  assert.match(notices, /Electron 43\.1\.0/);
  assert.match(notices, /LICENSES\.chromium\.html/);
  for (const dependency of productionPackages()) {
    assert.match(notices, new RegExp(
      `${dependency.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${dependency.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    ));
  }
});

test('installation docs explain checksums and provenance without overstating signing', () => {
  const installation = fs.readFileSync(path.join(root, 'site', 'docs', 'index.html'), 'utf8');
  const faq = fs.readFileSync(path.join(root, 'site', 'docs', 'faq.html'), 'utf8');
  for (const document of [installation, faq]) {
    assert.match(document, /checksums\.txt/);
    assert.match(document, /gh attestation verify &lt;file&gt; -R alfonza1\/hackers-lair/);
    assert.match(document, /not (?:Windows publisher )?code signing|not currently code-signed|neither is Windows publisher identity signing/i);
    assert.match(document, /SmartScreen/i);
  }
});
