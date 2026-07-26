const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

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
    assert.match(html, /<link rel="canonical" href="https:\/\/alfonza1\.github\.io\/hackers-lair\//, relative);
    assert.match(html, /<meta property="og:image" content="https:\/\/alfonza1\.github\.io\/hackers-lair\/assets\/og-card\.png">/, relative);
    assert.match(html, /href="[^"]*site\.css"/, relative);
    assert.match(html, /src="[^"]*site\.js"/, relative);
    assert.match(html, /href="[^"]*docs\/?[^"]*"/, relative);
    assert.doesNotMatch(html, /<(?:script|img)[^>]+src="https?:\/\//i, relative);
    assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"[^>]+href="https?:\/\//i, relative);
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
  assert.match(landing, /winget install --id Alfonza1\.HackersLair --exact/);
  assert.match(landing, /irm https:\/\/alfonza1\.github\.io\/hackers-lair\/install\.ps1 \| iex/);
  assert.match(installation, /hackers-lair_amd64\.deb/);
  assert.match(installation, /hackers-lair_x86_64\.rpm/);
  assert.match(installation, /hackers-lair-linux-x64\.tar\.gz/);
});

test('site scripts stay self-contained and installer mirrors stay exact', () => {
  const javascript = fs.readFileSync(path.join(site, 'assets', 'site.js'), 'utf8');
  assert.equal((javascript.match(/\bfetch\(/g) || []).length, 1);
  assert.match(javascript, /api\.github\.com\/repos\/alfonza1\/hackers-lair\/releases\?per_page=1/);
  assert.equal(
    fs.readFileSync(path.join(root, 'install.ps1'), 'utf8'),
    fs.readFileSync(path.join(site, 'install.ps1'), 'utf8'),
  );
  assert.equal(
    fs.readFileSync(path.join(root, 'uninstall.ps1'), 'utf8'),
    fs.readFileSync(path.join(site, 'uninstall.ps1'), 'utf8'),
  );
});

test('landing page transfer stays below 500 KB before optional release metadata', () => {
  const criticalFiles = [
    'index.html',
    'assets/site.css',
    'assets/site.js',
    'assets/command-line-mark.png',
    'assets/targets.jpg',
  ];
  const bytes = criticalFiles.reduce((total, relative) => (
    total + fs.statSync(path.join(site, relative)).size
  ), 0);
  assert.ok(bytes < 500 * 1024, `Landing transfer is ${bytes} bytes.`);
});
