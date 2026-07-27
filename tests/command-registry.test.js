const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { listCommands } = require('../lib/command-registry');

test('slash-command inventory scans nested user and project commands', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-commands-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claudeHome = path.join(root, 'claude');
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(claudeHome, 'commands', 'release'), { recursive: true });
  fs.mkdirSync(path.join(project, '.claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'commands', 'release', 'check.md'), [
    '---',
    'description: Check whether the current release is ready to publish.',
    '---',
    '',
    'Inspect the release.',
  ].join('\n'));
  fs.writeFileSync(path.join(project, '.claude', 'commands', 'brief.md'), 'A tiny note.');

  const commands = listCommands({ claudeHome, projectFolders: [project] });
  assert.deepEqual(
    commands.map(({ name, scope }) => ({ name, scope })),
    [
      { name: 'release/check', scope: 'user' },
      { name: 'brief', scope: 'project' },
    ],
  );
  assert.equal(commands[0].lint.level, 'ok');
  assert.equal(commands[1].lint.level, 'warn');
  assert.ok(commands.every((command) => !('file' in command)));
});

test('slash-command inventory tolerates missing and unreadable roots', () => {
  assert.deepEqual(listCommands({ claudeHome: path.resolve('missing-command-home') }), []);
});
