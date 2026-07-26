const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { discoverProjects, portsFromText } = require('../lib/project-discovery');

test('extracts explicit development ports without duplicates', () => {
  assert.deepEqual(portsFromText('vite --port 5173 --host localhost:5173'), [5173]);
});

test('discovers Node and Docker projects without writing configuration', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nodeProject = path.join(root, 'signal-board');
  const dockerProject = path.join(root, 'worker-stack');
  fs.mkdirSync(nodeProject);
  fs.mkdirSync(dockerProject);
  fs.writeFileSync(path.join(nodeProject, 'package.json'), JSON.stringify({
    name: 'signal-board',
    scripts: { dev: 'vite --port 5173' },
  }));
  fs.writeFileSync(path.join(dockerProject, 'compose.yml'), [
    'services:',
    '  api:',
    '    ports:',
    '      - "8080:8080"',
  ].join('\n'));

  const proposals = discoverProjects(root);
  assert.deepEqual(proposals.map((proposal) => proposal.name).sort(), ['signal-board', 'worker-stack']);
  assert.equal(proposals.find((proposal) => proposal.name === 'signal-board').components[0].port, 5173);
  assert.deepEqual(proposals.find((proposal) => proposal.name === 'worker-stack').components[0].ports, [8080]);
  assert.equal(fs.existsSync(path.join(root, 'projects.json')), false);
});
