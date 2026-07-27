const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { listSessions } = require('../lib/session-feed');

test('session feed stream-parses newest transcripts and redacts every returned string', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-sessions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectDirectory = path.join(root, 'projects', 'fixture');
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(path.join(projectDirectory, 'session.jsonl'), [
    JSON.stringify({
      timestamp: '2026-07-27T10:00:00Z',
      cwd: path.join(os.homedir(), 'private-project'),
      tool_name: 'Skill',
      tool_input: { skill: 'verify' },
    }),
    JSON.stringify({
      timestamp: '2026-07-27T10:05:00Z',
      cwd: path.join(os.homedir(), 'private-project'),
      tool_name: 'Read',
    }),
  ].join('\n'));
  const sessions = await listSessions({ claudeHome: root });
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].skills, ['verify']);
  assert.deepEqual(sessions[0].tools, ['Read', 'Skill']);
  assert.doesNotMatch(JSON.stringify(sessions), new RegExp(path.basename(os.homedir()), 'i'));
  assert.match(sessions[0].project, /%USERPROFILE%/);
});
