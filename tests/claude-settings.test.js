const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const {
  buildUsageHookCommand,
  inspectUsageHook,
  installUsageHooks,
  listConfiguredHooks,
  usageHooksBlock,
  writeUsageHookShim,
} = require('../lib/claude-settings');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-claude-settings-'));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  return {
    directory,
    settingsFile: path.join(directory, '.claude', 'settings.json'),
    shimFile: path.join(directory, 'data', 'hackers-lair-usage-hook.js'),
    usageLogFile: path.join(directory, '.agents', 'usage-log.jsonl'),
  };
}

test('hook JSON uses one cross-platform shim command for Skill and Task events', (t) => {
  const files = fixture(t);
  const command = buildUsageHookCommand(files.shimFile);
  const block = usageHooksBlock({ hookCommand: command });
  assert.deepEqual(block.PostToolUse.map((entry) => entry.matcher), ['Skill', 'Task']);
  assert.match(block.PostToolUse[0].hooks[0].command, /hackers-lair-usage-hook\.js.*skill/i);
  assert.match(block.PostToolUse[1].hooks[0].command, /hackers-lair-usage-hook\.js.*agent/i);
});

test('install merges hooks without replacing existing settings and backs up first', (t) => {
  const files = fixture(t);
  fs.mkdirSync(path.dirname(files.settingsFile), { recursive: true });
  fs.writeFileSync(files.settingsFile, JSON.stringify({
    permissions: { allow: ['Read'] },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo existing' }] }],
      PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo keep-me' }] }],
    },
  }, null, 2));
  writeUsageHookShim({
    shimFile: files.shimFile,
    usageLogFile: files.usageLogFile,
  });

  const result = installUsageHooks({
    settingsFile: files.settingsFile,
    hookCommand: buildUsageHookCommand(files.shimFile),
  });
  assert.equal(result.installed, true);
  assert.ok(result.backupFile);
  assert.ok(fs.existsSync(result.backupFile));
  const saved = JSON.parse(fs.readFileSync(files.settingsFile, 'utf8'));
  assert.deepEqual(saved.permissions.allow, ['Read']);
  assert.equal(saved.hooks.PreToolUse.length, 1);
  assert.deepEqual(saved.hooks.PostToolUse.map((entry) => entry.matcher), ['Write', 'Skill', 'Task']);
  assert.equal(inspectUsageHook({
    settingsFile: files.settingsFile,
    hookCommand: buildUsageHookCommand(files.shimFile),
  }).installed, true);
});

test('install is idempotent and refuses a conflicting Hacker Lair hook', (t) => {
  const files = fixture(t);
  fs.mkdirSync(path.dirname(files.settingsFile), { recursive: true });
  const command = buildUsageHookCommand(files.shimFile);
  fs.writeFileSync(files.settingsFile, JSON.stringify({
    hooks: usageHooksBlock({ hookCommand: command }),
  }));
  assert.equal(installUsageHooks({
    settingsFile: files.settingsFile,
    hookCommand: command,
  }).installed, false);

  const conflicting = JSON.parse(fs.readFileSync(files.settingsFile, 'utf8'));
  conflicting.hooks.PostToolUse[0].hooks[0].command = 'node "hackers-lair-usage-hook.js" wrong';
  fs.writeFileSync(files.settingsFile, JSON.stringify(conflicting));
  assert.throws(() => installUsageHooks({
    settingsFile: files.settingsFile,
    hookCommand: command,
  }), /different Hacker's Lair usage hook/i);
});

test('generated shim records only the allowed event fields', (t) => {
  const files = fixture(t);
  writeUsageHookShim({
    shimFile: files.shimFile,
    usageLogFile: files.usageLogFile,
  });
  const source = fs.readFileSync(files.shimFile, 'utf8');
  assert.match(source, /type.*name.*project.*ts.*source/s);
  assert.doesNotMatch(source, /prompt|credentials|environmentVariables/i);
  assert.ok(fs.statSync(files.shimFile).size > 100);

  execFileSync(process.execPath, [files.shimFile, 'skill'], {
    input: JSON.stringify({
      cwd: files.directory,
      tool_name: 'Skill',
      tool_input: {
        skill: 'verify',
        prompt: 'must not be logged',
        token: 'must not be logged',
      },
    }),
    windowsHide: true,
  });
  const logged = JSON.parse(fs.readFileSync(files.usageLogFile, 'utf8').trim());
  assert.deepEqual(Object.keys(logged), ['type', 'name', 'project', 'ts', 'source']);
  assert.equal(logged.type, 'skill');
  assert.equal(logged.name, 'verify');
  assert.equal(logged.project, files.directory);
  assert.equal(logged.source, 'hook');
  assert.doesNotMatch(JSON.stringify(logged), /must not be logged/);
});

test('configured hooks inventory is read-only and records source scope', (t) => {
  const files = fixture(t);
  fs.mkdirSync(path.dirname(files.settingsFile), { recursive: true });
  fs.writeFileSync(files.settingsFile, JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'node check.js' }],
      }],
    },
  }));
  assert.deepEqual(listConfiguredHooks([
    { file: files.settingsFile, scope: 'user' },
    { file: path.join(files.directory, 'missing.json'), scope: 'project' },
  ]), [{
    event: 'PreToolUse',
    matcher: 'Bash',
    type: 'command',
    command: 'node check.js',
    scope: 'user',
    source: files.settingsFile,
  }]);
});
