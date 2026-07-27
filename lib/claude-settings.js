const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('./runtime-config');

const USAGE_HOOK_SHIM_NAME = 'hackers-lair-usage-hook.js';

function quoteCommandArgument(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function buildUsageHookCommand(shimFile) {
  if (!path.isAbsolute(shimFile)) throw new Error('The usage hook shim path must be absolute.');
  return `node ${quoteCommandArgument(shimFile)}`;
}

function usageHooksBlock({ hookCommand }) {
  if (!String(hookCommand || '').trim()) throw new Error('hookCommand is required.');
  return {
    PostToolUse: [
      {
        matcher: 'Skill',
        hooks: [{ type: 'command', command: `${hookCommand} skill` }],
      },
      {
        matcher: 'Task',
        hooks: [{ type: 'command', command: `${hookCommand} agent` }],
      },
    ],
  };
}

function usageFallbackInstruction(usageLogFile) {
  if (!path.isAbsolute(usageLogFile)) throw new Error('The usage log path must be absolute.');
  return `After invoking a skill or subagent, append one JSON line to "${usageLogFile}" containing only type, name, project, ts, and source; never include prompts, file contents, tool arguments, environment variables, tokens, or credentials.`;
}

function readSettings(settingsFile) {
  try {
    return {
      exists: true,
      value: JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
      error: null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, value: {}, error: null };
    return { exists: true, value: null, error: `${settingsFile}: ${error.message}` };
  }
}

function hookCommands(entry) {
  return Array.isArray(entry?.hooks)
    ? entry.hooks.map((hook) => String(hook?.command || '')).filter(Boolean)
    : [];
}

function expectedHookMap(hookCommand) {
  return new Map(usageHooksBlock({ hookCommand }).PostToolUse
    .map((entry) => [entry.matcher, entry.hooks[0].command]));
}

function inspectUsageHook({ settingsFile, hookCommand }) {
  const read = readSettings(settingsFile);
  if (read.error) return { installed: false, conflict: false, error: read.error };
  const expected = expectedHookMap(hookCommand);
  const entries = Array.isArray(read.value?.hooks?.PostToolUse)
    ? read.value.hooks.PostToolUse
    : [];
  let conflict = false;
  const installedMatchers = new Set();
  for (const entry of entries) {
    for (const command of hookCommands(entry)) {
      if (!command.includes(USAGE_HOOK_SHIM_NAME)) continue;
      if (command === expected.get(entry.matcher)) installedMatchers.add(entry.matcher);
      else conflict = true;
    }
  }
  return {
    installed: !conflict && [...expected.keys()].every((matcher) => installedMatchers.has(matcher)),
    conflict,
    error: null,
  };
}

function timestampedBackup(settingsFile) {
  if (!fs.existsSync(settingsFile)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let backupFile = `${settingsFile}.backup-${timestamp}`;
  let collision = 0;
  while (fs.existsSync(backupFile)) {
    collision += 1;
    backupFile = `${settingsFile}.backup-${timestamp}-${collision}`;
  }
  fs.copyFileSync(settingsFile, backupFile);
  return backupFile;
}

function installUsageHooks({ settingsFile, hookCommand }) {
  if (!path.isAbsolute(settingsFile)) throw new Error('Claude settings path must be absolute.');
  const read = readSettings(settingsFile);
  if (read.error) throw new Error(`Claude settings are malformed; no changes were made. ${read.error}`);
  const status = inspectUsageHook({ settingsFile, hookCommand });
  if (status.conflict) {
    throw new Error("A different Hacker's Lair usage hook already exists. Remove or reconcile it manually.");
  }
  if (status.installed) return { installed: false, backupFile: null, settingsFile };

  const expected = usageHooksBlock({ hookCommand }).PostToolUse;
  const existingHooks = read.value.hooks && typeof read.value.hooks === 'object'
    && !Array.isArray(read.value.hooks)
    ? read.value.hooks
    : {};
  const postToolUse = Array.isArray(existingHooks.PostToolUse)
    ? [...existingHooks.PostToolUse]
    : [];
  for (const wanted of expected) {
    const command = wanted.hooks[0].command;
    const alreadyPresent = postToolUse.some((entry) => (
      entry.matcher === wanted.matcher && hookCommands(entry).includes(command)
    ));
    if (!alreadyPresent) postToolUse.push(wanted);
  }

  const backupFile = timestampedBackup(settingsFile);
  atomicWriteJson(settingsFile, {
    ...read.value,
    hooks: {
      ...existingHooks,
      PostToolUse: postToolUse,
    },
  });
  return { installed: true, backupFile, settingsFile };
}

function listConfiguredHooks(settingsSources) {
  const hooks = [];
  for (const source of settingsSources || []) {
    const read = readSettings(source.file);
    if (read.error || !read.exists) continue;
    const configuration = read.value?.hooks;
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) continue;
    for (const [event, entries] of Object.entries(configuration)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!Array.isArray(entry?.hooks)) continue;
        for (const hook of entry.hooks) {
          if (!hook || typeof hook !== 'object') continue;
          hooks.push({
            event,
            matcher: String(entry.matcher || ''),
            type: String(hook.type || ''),
            command: String(hook.command || ''),
            scope: String(source.scope || ''),
            source: source.file,
          });
        }
      }
    }
  }
  return hooks;
}

function usageHookShimSource(usageLogFile) {
  if (!path.isAbsolute(usageLogFile)) throw new Error('The usage log path must be absolute.');
  return `'use strict';
const fs = require('fs');
const path = require('path');
const usageLogFile = ${JSON.stringify(usageLogFile)};
const requestedType = process.argv[2] === 'agent' ? 'agent' : 'skill';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = input.trim() ? JSON.parse(input) : {};
    const toolInput = payload.tool_input && typeof payload.tool_input === 'object'
      ? payload.tool_input
      : {};
    const name = requestedType === 'agent'
      ? toolInput.subagent_type || toolInput.name || payload.tool_name || 'unknown-agent'
      : toolInput.skill || toolInput.name || payload.tool_name || 'unknown-skill';
    const event = {
      type: requestedType,
      name: String(name),
      project: String(payload.cwd || payload.project_dir || ''),
      ts: new Date().toISOString(),
      source: 'hook',
    };
    fs.mkdirSync(path.dirname(usageLogFile), { recursive: true });
    fs.appendFileSync(usageLogFile, JSON.stringify(event) + '\\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (error) {
    process.stderr.write("Hacker's Lair usage hook: " + error.message + '\\n');
    process.exitCode = 1;
  }
});
`;
}

function writeUsageHookShim({ shimFile, usageLogFile }) {
  if (!path.isAbsolute(shimFile)) throw new Error('The usage hook shim path must be absolute.');
  fs.mkdirSync(path.dirname(shimFile), { recursive: true });
  const temporary = `${shimFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, usageHookShimSource(usageLogFile), {
    encoding: 'utf8',
    mode: 0o700,
  });
  fs.renameSync(temporary, shimFile);
  return shimFile;
}

module.exports = {
  USAGE_HOOK_SHIM_NAME,
  buildUsageHookCommand,
  inspectUsageHook,
  installUsageHooks,
  listConfiguredHooks,
  readSettings,
  usageFallbackInstruction,
  usageHooksBlock,
  writeUsageHookShim,
};
