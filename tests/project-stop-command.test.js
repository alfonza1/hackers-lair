const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

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

async function waitFor(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

test('project stop runs its graceful stop command before process cleanup', async (t) => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manager-stop-'));
  const configPath = path.join(tempDirectory, 'projects.json');
  const stopMarker = path.join(tempDirectory, 'graceful-stop.txt');
  const match = `pm-stop-command-test-${process.pid}`;
  const projects = {
    projects: [{
      name: 'Stop command fixture',
      type: 'test',
      components: [{
        name: 'worker',
        role: 'backend',
        cwd: tempDirectory,
        command: `powershell -NoProfile -NonInteractive -Command "$null = '${match}'; Start-Sleep -Seconds 120"`,
        stopCommand: `powershell -NoProfile -NonInteractive -Command "Set-Content -LiteralPath '${stopMarker.replaceAll("'", "''")}' -Value stopped"`,
        port: null,
        track: 'process',
        match,
      }],
    }],
  };
  fs.writeFileSync(configPath, JSON.stringify(projects));

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const manager = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PROJECTS_FILE: configPath,
      PROJECT_MANAGER_DATA_DIR: tempDirectory,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  t.after(() => {
    try { manager.kill(); } catch { /* already stopped */ }
    const cleanupCommand = [
      'Get-CimInstance Win32_Process',
      `Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${match}*' }`,
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    ].join(' | ');
    spawnSync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      cleanupCommand,
    ], { windowsHide: true });
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  await waitFor(async () => (await fetch(`${baseUrl}/api/projects`)).ok, 'server did not start');
  const started = await postJson(`${baseUrl}/api/projects/start`, { name: 'Stop command fixture' });
  assert.deepEqual(started.started, ['worker']);

  await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/projects`);
    const payload = await response.json();
    return payload.projects[0].running;
  }, 'fixture process was not detected');

  const stopped = await postJson(`${baseUrl}/api/projects/stop`, { name: 'Stop command fixture' });

  assert.deepEqual(stopped.commandsRun, ['worker']);
  assert.equal(fs.readFileSync(stopMarker, 'utf8').trim(), 'stopped');
  assert.ok(stopped.stopped >= 1);
});
