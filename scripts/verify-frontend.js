const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const stylesheet = fs.readFileSync(path.join(root, 'public', 'operations-console.css'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];

if (!scripts.length) throw new Error('No frontend script was found.');
for (const [, source] of scripts) new Function(source);

for (const id of ['targetList', 'search', 'refreshBtn', 'systemToggle', 'feed', 'cpuUsage', 'memoryUsage']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Required UI contract #${id} is missing.`);
}

for (const token of ['--bg-void', '--surface-1', '--cyan', '--violet', '--healthy', '--danger', '--font-ui', '--normal']) {
  if (!stylesheet.includes(token)) throw new Error(`Design token ${token} is missing.`);
}

console.log(`Frontend verified: ${scripts.length} script block(s), required controls, and design tokens.`);
