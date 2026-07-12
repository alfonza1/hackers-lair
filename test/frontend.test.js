const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('preserves process-control API contracts', () => {
  for (const endpoint of ['/api/projects/start', '/api/projects/stop', '/api/kill', '/api/start', '/api/scripts/start', '/api/scripts/stop']) {
    assert.match(html, new RegExp(endpoint.replaceAll('/', '\\/')));
    assert.ok(server.includes(endpoint), `${endpoint} must remain implemented by the server`);
  }
});

test('preserves Electron window controls', () => {
  for (const action of ['minimize', 'maximize', 'close']) {
    assert.ok(html.includes(`data-window-control="${action}"`));
  }
});

test('includes distinct operational views and accessible live regions', () => {
  for (const view of ['projects', 'processes', 'scripts']) assert.ok(html.includes(`data-view="${view}"`));
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /prefers-reduced-motion/);
});
