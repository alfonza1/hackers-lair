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
  fs.writeFileSync(path.join(dataDirectory, 'projects.json'), '{"projects":[]}');
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PROJECT_MANAGER_DATA_DIR: dataDirectory,
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
  fs.mkdirSync(scanProject, { recursive: true });
  fs.writeFileSync(path.join(scanProject, 'package.json'), JSON.stringify({
    name: 'free-tool',
    scripts: { dev: 'vite --port 4173' },
  }));
  const authorizedHeaders = {
    'Content-Type': 'application/json',
    'X-Lair-Token': identity.token,
  };
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
      port: 4190,
    }],
  };
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
        components: [{ ...configuredProject.components[0], port: 4191 }],
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
    port: 4180,
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

  const exportResponse = await request({
    port,
    method: 'POST',
    pathname: '/api/config/export',
    headers: authorizedHeaders,
    body: '{}',
  });
  assert.equal(exportResponse.status, 200);
  assert.doesNotMatch(exportResponse.body, new RegExp(dataDirectory.replaceAll('\\', '\\\\'), 'i'));

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
  assert.match(html.headers['content-security-policy'], /default-src 'self'/);
  assert.match(html.body, new RegExp(identity.token));
  assert.doesNotMatch(html.body, /__LAIR_CSP_NONCE__|__LAIR_BOOTSTRAP_PAYLOAD__/);
});
