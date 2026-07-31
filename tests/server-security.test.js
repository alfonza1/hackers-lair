const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const ROOT = path.resolve(__dirname, '..');
const execFileAsync = promisify(execFile);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function uniqueFreePort(usedPorts) {
  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = await freePort();
    if (usedPorts.has(candidate)) continue;
    usedPorts.add(candidate);
    return candidate;
  }
  throw new Error(`Could not allocate a unique fixture port after ${maxAttempts} attempts.`);
}

async function waitForIdentity(file) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('identity file was not written');
}

function request({ port, method = 'GET', pathname = '/', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: pathname,
      headers,
    }, (res) => {
      let payload = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { payload += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: payload }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('protects localhost mutations and verifies the bound service identity', async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lair-security-'));
  const port = await freePort();
  const usedFixturePorts = new Set([port]);
  fs.writeFileSync(path.join(dataDirectory, 'projects.json'), '{"projects":[]}');
  fs.writeFileSync(path.join(dataDirectory, 'settings.json'), JSON.stringify({
    configVersion: 4,
    enableSkills: false,
    enableScripts: false,
    workspaceFolders: [dataDirectory],
    aiWorkflow: {
      enableUsageStats: true,
      coldSkillDays: 45,
      enableSessionFeed: false,
      contextTaxWarnTokens: 8000,
    },
  }));
  const scriptsDirectory = path.join(dataDirectory, 'autoit-scripts');
  fs.mkdirSync(scriptsDirectory);
  fs.writeFileSync(path.join(scriptsDirectory, 'window-layout.au3'), '; fixture');
  fs.writeFileSync(path.join(dataDirectory, 'scripts.json'), JSON.stringify({
    configVersion: 1,
    scriptsDir: scriptsDirectory,
    autoItExe: '',
    descriptions: {},
  }));
  const agentsHome = path.join(dataDirectory, '.agents');
  const claudeHome = path.join(dataDirectory, '.claude');
  const verifySkillDirectory = path.join(agentsHome, 'skills', 'verify');
  fs.mkdirSync(verifySkillDirectory, { recursive: true });
  fs.writeFileSync(path.join(verifySkillDirectory, 'SKILL.md'), [
    '---',
    'name: verify',
    'description: Verify repository changes through public interfaces before release.',
    '---',
    '',
    '# Verify',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(agentsHome, 'usage-log.jsonl'), [
    {
      type: 'skill',
      name: 'verify',
      project: dataDirectory,
      ts: new Date().toISOString(),
      source: 'manual',
    },
    {
      type: 'agent',
      name: 'reviewer',
      project: dataDirectory,
      ts: new Date().toISOString(),
      source: 'manual',
    },
    {
      type: 'command',
      name: 'release/check',
      project: dataDirectory,
      ts: new Date().toISOString(),
      source: 'manual',
    },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n');
  fs.mkdirSync(claudeHome, { recursive: true });
  fs.mkdirSync(path.join(claudeHome, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(claudeHome, 'commands', 'release'), { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'agents', 'reviewer.md'), [
    '---',
    'name: reviewer',
    'description: Review repository changes for correctness and security.',
    'tools: Read, Grep',
    'model: inherit',
    '---',
  ].join('\n'));
  fs.writeFileSync(path.join(claudeHome, 'commands', 'release', 'check.md'), [
    '---',
    'description: Check whether a release is ready for publication.',
    '---',
  ].join('\n'));
  const transcriptDirectory = path.join(claudeHome, 'projects', 'fixture');
  fs.mkdirSync(transcriptDirectory, { recursive: true });
  fs.writeFileSync(path.join(transcriptDirectory, 'session.jsonl'), `${JSON.stringify({
    timestamp: new Date().toISOString(),
    cwd: dataDirectory,
    tool_name: 'Skill',
    tool_input: { skill: 'verify' },
  })}\n`);
  const memoryDirectory = path.join(dataDirectory, '.claude', 'memory');
  fs.mkdirSync(memoryDirectory);
  fs.writeFileSync(path.join(memoryDirectory, 'decisions.md'), '# Fixture decisions');
  fs.writeFileSync(path.join(claudeHome, 'settings.json'), JSON.stringify({
    permissions: { allow: ['Read'] },
    mcpServers: {
      fixtureDocs: {
        command: 'node',
        env: { SECRET: 'must-not-leak' },
      },
    },
    hooks: {
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'node fixture-check.js' }],
      }],
    },
  }));
  fs.writeFileSync(path.join(dataDirectory, 'AGENTS.md'), [
    '# Fixture instructions',
    '',
    'Run `missing-lair-tool --verify` and inspect `scripts/missing.js`.',
    '',
  ].join('\n'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PROJECT_MANAGER_DATA_DIR: dataDirectory,
      AGENTS_HOME: agentsHome,
      CLAUDE_CONFIG_DIR: claudeHome,
      LAIR_WORKSPACE_ROOT: dataDirectory,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  const identity = await waitForIdentity(path.join(dataDirectory, 'api-token'));
  assert.equal(identity.port, port);
  assert.equal(identity.app, 'hackers-lair');

  const identityResponse = await request({ port, pathname: '/api/identity' });
  assert.equal(identityResponse.status, 200);
  assert.equal(JSON.parse(identityResponse.body).nonce, identity.nonce);
  assert.doesNotMatch(identityResponse.body, new RegExp(identity.token));

  const onboardingResponse = await request({
    port,
    pathname: `/api/onboarding?workspaceFolder=${encodeURIComponent(dataDirectory)}`,
  });
  assert.equal(onboardingResponse.status, 200);
  const onboarding = JSON.parse(onboardingResponse.body);
  const projectPrompt = onboarding.prompts.find((prompt) => prompt.id === 'projects').prompt;
  assert.match(projectPrompt, new RegExp(dataDirectory.replaceAll('\\', '\\\\'), 'i'));
  assert.match(projectPrompt, /projects\.schema\.json/);
  assert.match(projectPrompt, /lair doctor.*lair ls/s);

  const wrongHost = await request({
    port,
    pathname: '/api/identity',
    headers: { Host: `attacker.example:${port}` },
  });
  assert.equal(wrongHost.status, 403);

  const plainText = await request({
    port,
    method: 'POST',
    pathname: '/api/forget',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  });
  assert.equal(plainText.status, 415);

  const noToken = await request({
    port,
    method: 'POST',
    pathname: '/api/forget',
    headers: { 'Content-Type': 'application/json' },
    body: '{"id":"missing"}',
  });
  assert.equal(noToken.status, 403);

  const valid = await request({
    port,
    method: 'POST',
    pathname: '/api/forget',
    headers: {
      'Content-Type': 'application/json',
      'X-Lair-Token': identity.token,
    },
    body: '{"id":"missing"}',
  });
  assert.equal(valid.status, 200);

  const scanRoot = path.join(dataDirectory, 'scan-root');
  const scanProject = path.join(scanRoot, 'free-tool');
  const discoveredPort = await uniqueFreePort(usedFixturePorts);
  fs.mkdirSync(scanProject, { recursive: true });
  fs.writeFileSync(path.join(scanProject, 'package.json'), JSON.stringify({
    name: 'free-tool',
    scripts: { dev: `vite --port ${discoveredPort}` },
  }));
  const authorizedHeaders = {
    'Content-Type': 'application/json',
    'X-Lair-Token': identity.token,
  };
  const initialSettingsResponse = await request({ port, pathname: '/api/settings' });
  assert.equal(initialSettingsResponse.status, 200);
  const initialSettings = JSON.parse(initialSettingsResponse.body);
  assert.equal(initialSettings.enableSkills, false);
  assert.equal(initialSettings.enableScripts, false);
  assert.deepEqual(initialSettings.aiWorkflow, {
    enableUsageStats: true,
    coldSkillDays: 45,
    enableSessionFeed: false,
    contextTaxWarnTokens: 8000,
  });
  assert.equal((await request({ port, pathname: '/api/skills' })).status, 404);
  const initialScripts = JSON.parse((await request({ port, pathname: '/api/scripts' })).body);
  assert.equal(initialScripts.enabled, false);
  assert.equal(initialScripts.supported, process.platform === 'win32');
  assert.deepEqual(initialScripts.scripts, []);
  const disabledScriptStart = await request({
    port,
    method: 'POST',
    pathname: '/api/scripts/start',
    headers: authorizedHeaders,
    body: JSON.stringify({ file: 'disabled.au3' }),
  });
  assert.equal(disabledScriptStart.status, 404);

  const featureResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/settings/features',
    headers: authorizedHeaders,
    body: JSON.stringify({
      enableSkills: true,
      enableScripts: true,
    }),
  });
  assert.equal(featureResponse.status, 200);
  assert.deepEqual(JSON.parse(featureResponse.body), {
    ok: true,
    enableSkills: true,
    enableScripts: true,
  });
  const featureSettings = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'settings.json')));
  assert.equal(featureSettings.enableSkills, true);
  assert.equal(featureSettings.enableScripts, true);
  const enabledSkillsResponse = await request({ port, pathname: '/api/skills' });
  assert.equal(enabledSkillsResponse.status, 200);
  const enabledSkills = JSON.parse(enabledSkillsResponse.body);
  const verifySkill = enabledSkills.skills.find((skill) => skill.name === 'verify');
  assert.equal(verifySkill.usage.count, 1);
  assert.equal(verifySkill.lint.level, 'ok');
  assert.deepEqual(verifySkill.rating, { positive: 0, negative: 0 });
  assert.equal(verifySkill.canManage, true);
  assert.equal('directory' in verifySkill, false);
  assert.equal(JSON.parse((await request({ port, pathname: '/api/scripts' })).body).enabled, true);
  const enabledOnboarding = JSON.parse(
    (await request({ port, pathname: '/api/onboarding' })).body,
  );
  assert.match(enabledOnboarding.additionalSkillPrompt, /Existing personal skill names: verify/);
  if (process.platform === 'win32') {
    assert.match(
      enabledOnboarding.additionalScriptPrompt,
      new RegExp(scriptsDirectory.replaceAll('\\', '\\\\'), 'i'),
    );
    assert.match(enabledOnboarding.additionalScriptPrompt, /window-layout\.au3/);
  } else {
    assert.equal(enabledOnboarding.additionalScriptPrompt, '');
  }

  const contextCostResponse = await request({ port, pathname: '/api/ai/context-cost' });
  assert.equal(contextCostResponse.status, 200);
  assert.ok(Number.isInteger(JSON.parse(contextCostResponse.body).totalTokens));

  const agentOpsResponse = await request({ port, pathname: '/api/ai/ops' });
  assert.equal(agentOpsResponse.status, 200);
  const agentOps = JSON.parse(agentOpsResponse.body);
  assert.equal(agentOps.agents.find((agent) => agent.name === 'reviewer').usage.count, 1);
  assert.equal(
    agentOps.commands.find((command) => command.name === 'release/check').usage.count,
    1,
  );
  assert.equal(agentOps.mcpServers.find((server) => server.name === 'fixtureDocs').transport, 'stdio');
  assert.equal(agentOps.permissions.rules.some((rule) => rule.rule === 'Read'), true);
  assert.equal(agentOps.hooks.some((hook) => hook.matcher === 'Bash'), true);
  assert.equal(agentOps.usageHook.installed, false);
  assert.equal('sessionFeedEnabled' in agentOps, false);
  assert.equal('sessions' in agentOps, false);
  assert.equal(agentOps.memory.some((entry) => entry.name === 'decisions.md'), true);
  assert.doesNotMatch(agentOpsResponse.body, /must-not-leak|SECRET/);

  const instructionResponse = await request({ port, pathname: '/api/ai/instructions' });
  assert.equal(instructionResponse.status, 200);
  const instruction = JSON.parse(instructionResponse.body).instructions.find(
    (item) => item.name === 'AGENTS.md',
  );
  assert.ok(instruction);
  assert.equal(instruction.path, path.join(dataDirectory, 'AGENTS.md'));

  const driftResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/ai/instructions/drift',
    headers: authorizedHeaders,
    body: JSON.stringify({ id: instruction.id }),
  });
  assert.equal(driftResponse.status, 200);
  assert.deepEqual(
    JSON.parse(driftResponse.body).findings.map((finding) => finding.code).sort(),
    ['missing-command', 'missing-path'],
  );
  const arbitraryInstructionPath = await request({
    port,
    method: 'POST',
    pathname: '/api/ai/instructions/drift',
    headers: authorizedHeaders,
    body: JSON.stringify({ id: 'missing', file: path.join(dataDirectory, 'projects.json') }),
  });
  assert.equal(arbitraryInstructionPath.status, 404);

  const linkCheck = await request({
    port,
    method: 'POST',
    pathname: '/api/ai/check-urls',
    headers: authorizedHeaders,
    body: JSON.stringify({ kind: 'instruction', id: instruction.id }),
  });
  assert.equal(linkCheck.status, 200);
  assert.deepEqual(JSON.parse(linkCheck.body).results, []);
  const arbitraryLinkCheck = await request({
    port,
    method: 'POST',
    pathname: '/api/ai/check-urls',
    headers: authorizedHeaders,
    body: JSON.stringify({
      kind: 'instruction',
      id: 'missing',
      file: path.join(dataDirectory, 'projects.json'),
    }),
  });
  assert.equal(arbitraryLinkCheck.status, 404);

  for (const text of [
    'Agent skipped repository verification on run 1',
    'Agent skipped repository verification on run 2',
    'Agent skipped repository verification on run 3',
  ]) {
    const frictionResponse = await request({
      port,
      method: 'POST',
      pathname: '/api/ai/friction',
      headers: authorizedHeaders,
      body: JSON.stringify({ text, project: 'unknown-project' }),
    });
    assert.equal(frictionResponse.status, 201);
    assert.equal(JSON.parse(frictionResponse.body).entry.project, '');
  }
  const friction = JSON.parse((await request({ port, pathname: '/api/ai/friction' })).body);
  assert.equal(friction.entries.length, 3);
  assert.equal(friction.groups[0].count, 3);
  assert.equal(friction.groups[0].nudge, true);

  const invalidFriction = await request({
    port,
    method: 'POST',
    pathname: '/api/ai/friction',
    headers: authorizedHeaders,
    body: JSON.stringify({ text: ' ' }),
  });
  assert.equal(invalidFriction.status, 400);

  const reportResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/ai/report',
    headers: authorizedHeaders,
    body: '{}',
  });
  assert.equal(reportResponse.status, 201);
  const report = JSON.parse(reportResponse.body);
  assert.ok(fs.existsSync(report.file));
  assert.match(report.markdown, /workflow report/i);
  assert.match(report.markdown, /Drift findings: 2/);

  const repairPromptResponse = await request({ port, pathname: '/api/ai/repair-prompt' });
  assert.equal(repairPromptResponse.status, 200);
  assert.match(JSON.parse(repairPromptResponse.body).prompt, /read-only first|No actionable/i);

  const workflowExportResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/ai/export',
    headers: authorizedHeaders,
    body: JSON.stringify({ reveal: false }),
  });
  assert.equal(workflowExportResponse.status, 201);
  const workflowExport = JSON.parse(workflowExportResponse.body);
  assert.ok(fs.existsSync(path.join(workflowExport.directory, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(workflowExport.directory, 'hooks.json')));

  const unsafeScaffold = await request({
    port,
    method: 'POST',
    pathname: '/api/skills',
    headers: authorizedHeaders,
    body: JSON.stringify({ name: '../escape' }),
  });
  assert.equal(unsafeScaffold.status, 400);
  assert.equal(fs.existsSync(path.join(agentsHome, 'escape')), false);

  const scaffold = await request({
    port,
    method: 'POST',
    pathname: '/api/skills',
    headers: authorizedHeaders,
    body: JSON.stringify({ name: 'release-helper' }),
  });
  assert.equal(scaffold.status, 201);
  const scaffoldedSkills = JSON.parse((await request({ port, pathname: '/api/skills' })).body);
  const releaseHelper = scaffoldedSkills.skills.find((skill) => skill.name === 'release-helper');
  assert.ok(releaseHelper);
  assert.equal(releaseHelper.lint.level, 'ok');

  const ratingResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/skills/rate',
    headers: authorizedHeaders,
    body: JSON.stringify({ id: verifySkill.id, rating: 'positive' }),
  });
  assert.equal(ratingResponse.status, 200);
  assert.deepEqual(JSON.parse(ratingResponse.body).rating, { positive: 1, negative: 0 });

  const bundledSkill = scaffoldedSkills.skills.find((skill) => skill.kind === 'default');
  const protectedArchive = await request({
    port,
    method: 'POST',
    pathname: '/api/skills/archive',
    headers: authorizedHeaders,
    body: JSON.stringify({ id: bundledSkill.id }),
  });
  assert.equal(protectedArchive.status, 403);

  const archiveResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/skills/archive',
    headers: authorizedHeaders,
    body: JSON.stringify({ id: releaseHelper.id }),
  });
  assert.equal(archiveResponse.status, 200);
  const afterArchive = JSON.parse((await request({ port, pathname: '/api/skills' })).body);
  assert.equal(afterArchive.skills.some((skill) => skill.name === 'release-helper'), false);
  assert.equal(afterArchive.archived.some((skill) => skill.name === 'release-helper'), true);

  const unarchiveResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/skills/unarchive',
    headers: authorizedHeaders,
    body: JSON.stringify({ name: 'release-helper' }),
  });
  assert.equal(unarchiveResponse.status, 200);
  assert.equal(
    JSON.parse((await request({ port, pathname: '/api/skills' })).body)
      .skills.some((skill) => skill.name === 'release-helper'),
    true,
  );

  const setupResponse = await request({ port, pathname: '/api/ai/setup' });
  assert.equal(setupResponse.status, 200);
  const setup = JSON.parse(setupResponse.body);
  assert.equal(setup.hookInstalled, false);
  assert.equal(setup.usageLogFile, path.join(agentsHome, 'usage-log.jsonl'));
  assert.equal(setup.claudeSettingsFile, path.join(claudeHome, 'settings.json'));
  assert.match(setup.hookJson.hooks.PostToolUse[0].hooks[0].command, /hackers-lair-usage-hook/);
  assert.ok(setup.fallbackInstruction.includes(path.join(agentsHome, 'usage-log.jsonl')));
  assert.match(setup.fallbackInstruction, /never include prompts/);
  assert.match(setup.prompt, /Inspect all four files read-only first/);
  assert.equal(
    JSON.parse((await request({ port, pathname: '/api/onboarding' })).body)
      .prompts.some((prompt) => prompt.id === 'usage'),
    true,
  );
  const hookInstall = await request({
    port,
    method: 'POST',
    pathname: '/api/ai/hooks/install',
    headers: authorizedHeaders,
    body: '{}',
  });
  assert.equal(hookInstall.status, 200);
  assert.equal(JSON.parse(hookInstall.body).hookInstalled, true);
  const installedClaudeSettings = JSON.parse(
    fs.readFileSync(path.join(claudeHome, 'settings.json'), 'utf8'),
  );
  assert.deepEqual(installedClaudeSettings.permissions.allow, ['Read']);
  assert.deepEqual(
    installedClaudeSettings.hooks.PostToolUse.map((entry) => entry.matcher),
    ['Skill', 'Task'],
  );
  assert.equal(
    JSON.parse((await request({ port, pathname: '/api/onboarding' })).body)
      .prompts.some((prompt) => prompt.id === 'usage'),
    false,
  );
  assert.ok(fs.readdirSync(claudeHome).some((name) => name.includes('.backup-')));

  const aiSettings = await request({
    port,
    method: 'POST',
    pathname: '/api/settings/ai-workflow',
    headers: authorizedHeaders,
    body: JSON.stringify({
      enableUsageStats: false,
      coldSkillDays: 60,
      enableSessionFeed: true,
      contextTaxWarnTokens: 1000,
    }),
  });
  assert.equal(aiSettings.status, 200);
  assert.equal(JSON.parse(aiSettings.body).aiWorkflow.coldSkillDays, 60);
  assert.equal(JSON.parse(aiSettings.body).aiWorkflow.enableSessionFeed, true);
  const sessionEnabledOps = JSON.parse(
    (await request({ port, pathname: '/api/ai/ops' })).body,
  );
  assert.equal('sessionFeedEnabled' in sessionEnabledOps, false);
  assert.equal('sessions' in sessionEnabledOps, false);
  assert.equal(
    sessionEnabledOps.agents.find((agent) => agent.name === 'reviewer').usage.count,
    1,
  );
  assert.doesNotMatch(JSON.stringify(sessionEnabledOps), /verify transcript|must-not-leak|SECRET/);
  assert.equal(
    JSON.parse((await request({ port, pathname: '/api/ai/context-cost' })).body).warnTokens,
    8000,
  );

  const invalidFeatures = await request({
    port,
    method: 'POST',
    pathname: '/api/settings/features',
    headers: authorizedHeaders,
    body: JSON.stringify({
      enableSkills: 'yes',
      enableScripts: true,
    }),
  });
  assert.equal(invalidFeatures.status, 400);
  const invalidFeatureShape = await request({
    port,
    method: 'POST',
    pathname: '/api/settings/features',
    headers: authorizedHeaders,
    body: 'null',
  });
  assert.equal(invalidFeatureShape.status, 400);

  const runtimeLogDirectory = path.join(dataDirectory, 'logs');
  fs.mkdirSync(runtimeLogDirectory, { recursive: true });
  fs.writeFileSync(path.join(runtimeLogDirectory, 'runtime-errors.log'), 'sanitized fixture');
  const logSummary = await request({ port, pathname: '/api/logs' });
  assert.equal(logSummary.status, 200);
  assert.equal(JSON.parse(logSummary.body).bytes, 'sanitized fixture'.length);
  const clearLogs = await request({
    port,
    method: 'POST',
    pathname: '/api/logs/clear',
    headers: authorizedHeaders,
    body: '{}',
  });
  assert.equal(clearLogs.status, 200);
  assert.equal(JSON.parse(clearLogs.body).cleared, 1);
  assert.equal(fs.statSync(path.join(runtimeLogDirectory, 'runtime-errors.log')).size, 0);

  const preferenceResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/settings/preferences',
    headers: authorizedHeaders,
    body: JSON.stringify({
      theme: 'ghost',
      density: 'compact',
      motion: 'reduced',
      fontScale: 110,
    }),
  });
  assert.equal(preferenceResponse.status, 200);
  const persistedSettings = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'settings.json')));
  assert.equal(persistedSettings.uiPreferences.theme, 'ghost');
  assert.equal(persistedSettings.uiPreferences.fontScale, 110);

  const invalidPreferences = await request({
    port,
    method: 'POST',
    pathname: '/api/settings/preferences',
    headers: authorizedHeaders,
    body: JSON.stringify({
      theme: 'custom',
      density: 'compact',
      motion: 'reduced',
      fontScale: 110,
    }),
  });
  assert.equal(invalidPreferences.status, 400);

  const scanResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/discovery/scan',
    headers: authorizedHeaders,
    body: JSON.stringify({ folder: scanRoot }),
  });
  assert.equal(scanResponse.status, 200);
  const scan = JSON.parse(scanResponse.body);
  assert.equal(scan.proposals[0].name, 'free-tool');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDirectory, 'projects.json'))).projects, []);

  const applyResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/discovery/apply',
    headers: authorizedHeaders,
    body: JSON.stringify({ scanId: scan.scanId, indexes: [0] }),
  });
  assert.equal(applyResponse.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDirectory, 'projects.json'))).projects[0].name, 'free-tool');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dataDirectory, 'settings.json'))).workspaceFolders,
    [path.resolve(scanRoot)],
  );

  const configuredProject = {
    name: 'editor-project',
    type: 'Node',
    components: [{
      name: 'web',
      role: 'frontend',
      cwd: scanProject,
      command: 'npm run dev',
      match: scanProject,
      port: await uniqueFreePort(usedFixturePorts),
    }],
  };
  const occupiedServer = net.createServer();
  await new Promise((resolve, reject) => {
    occupiedServer.once('error', reject);
    occupiedServer.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => occupiedServer.close(resolve)));
  const occupiedPort = occupiedServer.address().port;
  usedFixturePorts.add(occupiedPort);
  const conflictingProject = await request({
    port,
    method: 'POST',
    pathname: '/api/projects/configure',
    headers: authorizedHeaders,
    body: JSON.stringify({
      project: {
        ...configuredProject,
        name: 'occupied-project',
        components: [{ ...configuredProject.components[0], port: occupiedPort }],
      },
    }),
  });
  assert.equal(conflictingProject.status, 409);
  const conflictPayload = JSON.parse(conflictingProject.body);
  assert.equal(conflictPayload.portConflicts[0].port, occupiedPort);
  assert.equal(conflictPayload.portConflicts[0].pid, process.pid);
  assert.match(conflictPayload.error, new RegExp(`port ${occupiedPort}`, 'i'));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dataDirectory, 'projects.json'))).projects
      .some((project) => project.name === 'occupied-project'),
    false,
  );
  const occupiedTemplate = await request({
    port,
    method: 'POST',
    pathname: '/api/templates/apply',
    headers: authorizedHeaders,
    body: JSON.stringify({
      templateId: 'vite',
      name: 'occupied-template',
      folder: scanProject,
      port: occupiedPort,
    }),
  });
  assert.equal(occupiedTemplate.status, 409);
  assert.equal(JSON.parse(occupiedTemplate.body).portConflicts[0].port, occupiedPort);
  const createProject = await request({
    port,
    method: 'POST',
    pathname: '/api/projects/configure',
    headers: authorizedHeaders,
    body: JSON.stringify({ project: configuredProject }),
  });
  assert.equal(createProject.status, 200);
  const updateProject = await request({
    port,
    method: 'POST',
    pathname: '/api/projects/configure',
    headers: authorizedHeaders,
    body: JSON.stringify({
      originalName: configuredProject.name,
      project: {
        ...configuredProject,
        name: 'editor-project-renamed',
        components: [{
          ...configuredProject.components[0],
          port: await uniqueFreePort(usedFixturePorts),
        }],
      },
    }),
  });
  assert.equal(updateProject.status, 200);
  const removeProject = await request({
    port,
    method: 'POST',
    pathname: '/api/projects/remove',
    headers: authorizedHeaders,
    body: JSON.stringify({ name: 'editor-project-renamed' }),
  });
  assert.equal(removeProject.status, 200);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dataDirectory, 'projects.json'))).projects
      .some((project) => project.name === 'editor-project-renamed'),
    false,
  );

  const schemaResponse = await request({ port, pathname: '/api/schema/projects' });
  assert.equal(schemaResponse.status, 200);
  assert.equal(JSON.parse(schemaResponse.body).title, "Hacker's Lair project configuration");
  const settingsSchemaResponse = await request({ port, pathname: '/api/schema/settings' });
  assert.equal(settingsSchemaResponse.status, 200);
  assert.equal(JSON.parse(settingsSchemaResponse.body).title, "Hacker's Lair settings");

  const invalidImport = await request({
    port,
    method: 'POST',
    pathname: '/api/config/import',
    headers: authorizedHeaders,
    body: JSON.stringify({
      mode: 'merge',
      config: { projects: [{ name: 'invalid', components: [{ name: 'web', port: 99999 }] }] },
    }),
  });
  assert.equal(invalidImport.status, 400);

  const templateBody = JSON.stringify({
    templateId: 'vite',
    name: 'templated-project',
    folder: scanProject,
    port: await uniqueFreePort(usedFixturePorts),
  });
  const templateResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/templates/apply',
    headers: authorizedHeaders,
    body: templateBody,
  });
  assert.equal(templateResponse.status, 200);
  const duplicateTemplate = await request({
    port,
    method: 'POST',
    pathname: '/api/templates/apply',
    headers: authorizedHeaders,
    body: templateBody,
  });
  assert.equal(duplicateTemplate.status, 409);
  const conflictingTemplate = await request({
    port,
    method: 'POST',
    pathname: '/api/templates/apply',
    headers: authorizedHeaders,
    body: JSON.stringify({
      templateId: 'vite',
      name: 'port-conflict',
      folder: scanProject,
      port: discoveredPort,
    }),
  });
  assert.equal(conflictingTemplate.status, 409);

  const exportResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/config/export',
    headers: authorizedHeaders,
    body: '{}',
  });
  assert.equal(exportResponse.status, 200);
  assert.doesNotMatch(
    exportResponse.body,
    new RegExp(dataDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
  );

  const { stdout: cliOutput } = await execFileAsync(process.execPath, [path.join(ROOT, 'bin', 'lair.js'), 'ls'], {
    cwd: ROOT,
    env: { ...process.env, PROJECT_MANAGER_DATA_DIR: dataDirectory },
    windowsHide: true,
    timeout: 10_000,
  });
  assert.match(cliOutput, /free-tool/);
  assert.match(cliOutput, /templated-project/);

  const html = await request({ port });
  assert.equal(html.status, 200);
  assert.equal(html.headers['cache-control'], 'no-store');
  assert.match(html.headers['content-security-policy'], /default-src 'self'/);
  assert.match(html.body, new RegExp(identity.token));
  assert.doesNotMatch(html.body, /__LAIR_CSP_NONCE__|__LAIR_BOOTSTRAP_PAYLOAD__/);

  const icon = await request({ port, pathname: '/icon.ico' });
  assert.equal(icon.status, 200);
  assert.equal(icon.headers['cache-control'], 'public, max-age=31536000, immutable');

  const shutdownExit = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  const shutdown = await request({
    port,
    method: 'POST',
    pathname: '/api/service/shutdown',
    headers: authorizedHeaders,
    body: '{}',
  });
  assert.equal(shutdown.status, 200);
  assert.equal(await shutdownExit, 0);
  assert.equal(fs.existsSync(path.join(dataDirectory, 'api-token')), false);
});
