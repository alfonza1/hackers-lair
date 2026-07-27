const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const site = path.join(root, 'site');
const publicPages = [
  'index.html',
  'getting-started/index.html',
  'docs/index.html',
  'docs/configuration.html',
  'docs/detection.html',
  'docs/troubleshooting.html',
  'docs/faq.html',
  'docs/uninstall.html',
];

test('static site ships complete metadata, docs navigation, and local assets', () => {
  for (const relative of publicPages) {
    const file = path.join(site, relative);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /<title>[^<]+<\/title>/, relative);
    assert.match(html, /<meta name="description" content="[^"]+"/, relative);
    assert.match(html, /<link rel="canonical" href="https:\/\/hackerslairhq\.github\.io\/desktop\//, relative);
    assert.match(html, /<meta property="og:image" content="https:\/\/hackerslairhq\.github\.io\/desktop\/assets\/og-card\.png">/, relative);
    assert.match(html, /href="[^"]*site\.css"/, relative);
    assert.match(html, /src="[^"]*site\.js"/, relative);
    assert.match(html, /href="[^"]*docs\/?[^"]*"/, relative);
    assert.doesNotMatch(html, /<(?:script|img)[^>]+src="https?:\/\//i, relative);
    assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"[^>]+href="https?:\/\//i, relative);
  }
});

test('site typography is self-hosted and assigns industrial display and mono-first body roles', () => {
  const stylesheet = fs.readFileSync(path.join(site, 'assets', 'site.css'), 'utf8');
  const fontFiles = [
    'big-shoulders-bold.ttf',
    'geist-mono-regular.ttf',
    'geist-mono-bold.ttf',
  ];
  const licenseFiles = [
    'OFL-Big-Shoulders.txt',
    'OFL-Geist-Mono.txt',
  ];

  assert.match(stylesheet, /--font-display:\s*"Lair Display"/);
  assert.match(stylesheet, /--font-body:\s*"Lair Mono"/);
  assert.match(stylesheet, /--font-mono:\s*"Lair Mono"/);
  assert.match(stylesheet, /body\s*\{[\s\S]*font:\s*15px\/1\.68 var\(--font-body\)/);
  assert.match(stylesheet, /\.hero-copy h1\s*\{[\s\S]*font-family:\s*var\(--font-display\)/);
  assert.match(stylesheet, /\.hero-copy h1\s*\{[\s\S]*font-weight:\s*700/);
  assert.match(stylesheet, /\.terminal-window\s*\{[\s\S]*font-family:\s*var\(--font-mono\)/);
  assert.doesNotMatch(stylesheet, /url\(["']?https?:\/\//i);

  for (const fontFile of fontFiles) {
    assert.ok(fs.existsSync(path.join(site, 'assets', 'fonts', fontFile)), fontFile);
    assert.match(stylesheet, new RegExp(fontFile.replaceAll('.', '\\.')));
  }
  for (const licenseFile of licenseFiles) {
    assert.ok(fs.existsSync(path.join(site, 'assets', 'fonts', licenseFile)), licenseFile);
  }
});

test('installation remains command-only and useful without JavaScript', () => {
  const landing = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const installation = fs.readFileSync(path.join(site, 'docs', 'index.html'), 'utf8');
  assert.doesNotMatch(`${landing}\n${installation}`, /<a[^>]+releases\/download/i);
  assert.doesNotMatch(`${landing}\n${installation}`, /<button[^>]*>\s*download/i);
  assert.doesNotMatch(`${landing}\n${installation}`, /<(?:a|button)[^>]*\sdownload(?:=|\s|>)/i);
  assert.match(landing, /data-platform-panel="windows"/);
  assert.match(landing, /data-platform-panel="linux"/);
  assert.doesNotMatch(landing, /data-platform-panel="[^"]+"[^>]*hidden/);
  assert.match(landing, /irm https:\/\/hackerslairhq\.github\.io\/desktop\/install\.ps1 \| iex/);
  assert.match(landing, /windows_x64<\/span>[^<]*checksum-verified PowerShell/);
  assert.doesNotMatch(landing, /<code>winget install --id hackerslair\.desktop --exact<\/code>/);
  assert.match(installation, /hackers-lair_amd64\.deb/);
  assert.match(installation, /hackers-lair_x86_64\.rpm/);
  assert.match(installation, /hackers-lair-linux-x64\.tar\.gz/);
  assert.match(installation, /gh attestation verify &lt;file&gt; -R hackerslairhq\/desktop/);
});

test('public branding uses the product-owned Winget identity', () => {
  const publicCopy = publicPages
    .map((relative) => fs.readFileSync(path.join(site, relative), 'utf8'))
    .join('\n');
  const visibleProse = publicCopy
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '')
    .replace(/<[^>]+>/g, ' ');

  assert.match(publicCopy, /hackerslair\.desktop/);
  assert.doesNotMatch(publicCopy, /alfonza1|Alfonza Jones/i);
  assert.doesNotMatch(visibleProse, /alfonza/i);
});

test('landing page gives engineers a concrete contribution path', () => {
  const landing = fs.readFileSync(path.join(site, 'index.html'), 'utf8');

  assert.match(landing, /id="contribute"/);
  assert.match(landing, /Engineers: take a subsystem\./);
  assert.match(landing, /Where help matters/);
  assert.match(landing, /Your first patch/);
  assert.match(landing, /href="https:\/\/github\.com\/hackerslairhq\/desktop\/blob\/main\/CONTRIBUTING\.md"/);
  assert.match(landing, /href="https:\/\/github\.com\/hackerslairhq\/desktop\/issues"/);
  assert.ok(landing.indexOf('id="contribute"') < landing.indexOf('id="release-title"'));
});

test('site scripts stay self-contained and installer mirrors stay exact', () => {
  const javascript = fs.readFileSync(path.join(site, 'assets', 'site.js'), 'utf8');
  assert.equal((javascript.match(/\bfetch\(/g) || []).length, 1);
  assert.match(javascript, /api\.github\.com\/repos\/hackerslairhq\/desktop\/releases\?per_page=1/);
  assert.equal(
    fs.readFileSync(path.join(root, 'install.ps1'), 'utf8'),
    fs.readFileSync(path.join(site, 'install.ps1'), 'utf8'),
  );
  assert.equal(
    fs.readFileSync(path.join(root, 'uninstall.ps1'), 'utf8'),
    fs.readFileSync(path.join(site, 'uninstall.ps1'), 'utf8'),
  );
});

test('live release notes omit GitHub identities and raw URLs', async () => {
  const javascript = fs.readFileSync(path.join(site, 'assets', 'site.js'), 'utf8');
  const releaseNotes = { textContent: '' };
  const selectors = new Map([
    ['[data-release-version]', [{ textContent: '' }]],
    ['[data-release-notes]', [releaseNotes]],
    ['[data-release-date]', [{ textContent: '' }]],
  ]);
  const context = {
    console,
    Date,
    document: {
      documentElement: { classList: { add() {} } },
      querySelectorAll(selector) {
        return selectors.get(selector) || [];
      },
    },
    fetch: async () => ({
      ok: true,
      json: async () => [{
        tag_name: 'v2.1.0-beta.1',
        published_at: '2026-07-26T00:00:00Z',
        body: "## What's Changed\nDesktop polish by @private-owner in https://github.com/private-owner/project/pull/10\n**Full Changelog**: https://github.com/private-owner/project/compare/v1...v2",
      }],
    }),
    matchMedia: () => ({ matches: true }),
    setTimeout,
  };

  vm.runInNewContext(javascript, context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(releaseNotes.textContent, /Desktop polish/);
  assert.doesNotMatch(releaseNotes.textContent, /private-owner|github\.com|https?:\/\//i);
});

test('landing page transfer stays below 500 KB before optional release metadata', () => {
  const criticalFiles = [
    'index.html',
    'assets/site.css',
    'assets/site.js',
    'assets/command-line-mark.png',
    'assets/targets.jpg',
    'assets/fonts/big-shoulders-bold.ttf',
    'assets/fonts/geist-mono-regular.ttf',
    'assets/fonts/geist-mono-bold.ttf',
  ];
  const bytes = criticalFiles.reduce((total, relative) => (
    total + fs.statSync(path.join(site, relative)).size
  ), 0);
  assert.ok(bytes < 500 * 1024, `Landing transfer is ${bytes} bytes.`);
});

test('getting started presents the recommended agent path before guided setup', () => {
  const guide = fs.readFileSync(path.join(site, 'getting-started', 'index.html'), 'utf8');
  assert.ok(guide.indexOf('id="agent-setup"') < guide.indexOf('id="wizard"'));
  assert.match(guide, /recommended first option/i);
  assert.doesNotMatch(guide, /second empty-state path/i);
});
