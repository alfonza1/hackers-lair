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

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    try {
      child.kill();
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

async function removeDirectoryWithRetry(directory) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error.code !== 'EPERM' || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

function apiToken(dataDirectory) {
  return JSON.parse(fs.readFileSync(path.join(dataDirectory, 'api-token'), 'utf8')).token;
}

async function postJson(url, body, dataDirectory) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Lair-Token': apiToken(dataDirectory),
    },
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
  const workerPath = path.join(tempDirectory, 'worker.js');
  const workerPort = await freePort();
  const unrelatedPort = await freePort();
  const match = `pm-stop-command-test-${process.pid}`;
  fs.writeFileSync(
    workerPath,
    "for (const port of process.argv.slice(2).map(Number).filter(Number.isInteger)) require('node:http').createServer((_request, response) => response.end('ok')).listen(port, '127.0.0.1');",
  );
  const projects = {
    projects: [{
      name: 'Stop command fixture',
      type: 'test',
      components: [{
        name: 'worker',
        role: 'backend',
        cwd: tempDirectory,
        command: `"${process.execPath}" "${workerPath}" ${workerPort} ${unrelatedPort} ${match}`,
        stopCommand: `powershell -NoProfile -NonInteractive -Command "Start-Sleep -Milliseconds 800; Set-Content -LiteralPath '${stopMarker.replaceAll("'", "''")}' -Value stopped"`,
        port: workerPort,
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
  const started = await postJson(`${baseUrl}/api/projects/start`, { name: 'Stop command fixture' }, tempDirectory);
  assert.deepEqual(started.started, ['worker']);

  await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/projects`);
    const payload = await response.json();
    const component = payload.projects[0].components[0];
    return payload.projects[0].running
      && component.livePorts.includes(workerPort)
      && !component.livePorts.includes(unrelatedPort);
  }, 'fixture process was not detected');

  const stopping = postJson(`${baseUrl}/api/projects/stop`, { name: 'Stop command fixture' }, tempDirectory);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const competing = await fetch(`${baseUrl}/api/projects/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Lair-Token': apiToken(tempDirectory),
    },
    body: JSON.stringify({ name: 'Stop command fixture' }),
  });
  assert.equal(competing.status, 409);
  const stopped = await stopping;

  assert.deepEqual(stopped.commandsRun, ['worker']);
  assert.equal(fs.readFileSync(stopMarker, 'utf8').trim(), 'stopped');
  assert.ok(stopped.stopped >= 1);

  const afterStopResponse = await fetch(`${baseUrl}/api/projects`);
  const afterStopPayload = await afterStopResponse.json();
  const stoppedProject = afterStopPayload.projects[0];
  const persistedActivity = JSON.parse(fs.readFileSync(path.join(tempDirectory, 'project-activity.json'), 'utf8'));
  assert.ok(stoppedProject.lastActionAt > stoppedProject.lastStartedAt);
  assert.equal(persistedActivity['Stop command fixture'], stoppedProject.lastActionAt);
});

test('declared ports keep a service stoppable after its tracked wrapper exits', async (t) => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manager-port-stop-'));
  const configPath = path.join(tempDirectory, 'projects.json');
  const stopMarker = path.join(tempDirectory, 'port-stop.txt');
  const workerPath = path.join(tempDirectory, 'worker.js');
  const workerPorts = [await freePort(), await freePort()];
  const unrelatedPort = await freePort();
  fs.writeFileSync(
    workerPath,
    "for (const port of process.argv.slice(2).map(Number)) require('node:http').createServer((_request, response) => response.end('ok')).listen(port, '127.0.0.1');",
  );
  const worker = spawn(process.execPath, [workerPath, ...workerPorts.map(String), String(unrelatedPort)], {
    cwd: tempDirectory,
    stdio: 'ignore',
    windowsHide: true,
  });
  const projects = {
    projects: [{
      name: 'Port-detected fixture',
      type: 'test',
      components: [{
        name: 'stack',
        role: 'fullstack',
        cwd: tempDirectory,
        command: 'this-command-must-not-run',
        stopCommand: `powershell -NoProfile -NonInteractive -Command "Set-Content -LiteralPath '${stopMarker.replaceAll("'", "''")}' -Value stopped; Stop-Process -Id ${worker.pid} -Force"`,
        ports: workerPorts,
        uiPorts: [workerPorts[0]],
        backendPorts: [workerPorts[1]],
        track: 'process',
        match: 'wrapper-that-already-exited',
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
  t.after(async () => {
    await Promise.all([stopChild(manager), stopChild(worker)]);
    await removeDirectoryWithRetry(tempDirectory);
  });

  await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/projects`);
    if (!response.ok) return false;
    const payload = await response.json();
    const component = payload.projects[0].components[0];
    return payload.projects[0].running
      && workerPorts.every((port) => component.livePorts.includes(port))
      && !component.livePorts.includes(unrelatedPort);
  }, 'port-detected fixture was not reported running');

  const start = await postJson(`${baseUrl}/api/projects/start`, { name: 'Port-detected fixture' }, tempDirectory);
  assert.deepEqual(start.skipped, ['stack']);

  const stopped = await postJson(`${baseUrl}/api/projects/stop`, { name: 'Port-detected fixture' }, tempDirectory);
  assert.deepEqual(stopped.commandsRun, ['stack']);
  assert.equal(fs.readFileSync(stopMarker, 'utf8').trim(), 'stopped');
});

test('does not report success while configured ports remain live', async (t) => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manager-stop-verify-'));
  const configPath = path.join(tempDirectory, 'projects.json');
  const stopMarker = path.join(tempDirectory, 'stop-attempted.txt');
  const workerPath = path.join(tempDirectory, 'worker.js');
  const workerPort = await freePort();
  fs.writeFileSync(
    workerPath,
    "require('node:http').createServer((_request, response) => response.end('ok')).listen(Number(process.argv[2]), '127.0.0.1');",
  );
  const worker = spawn(process.execPath, [workerPath, String(workerPort)], {
    cwd: tempDirectory,
    stdio: 'ignore',
    windowsHide: true,
  });
  fs.writeFileSync(configPath, JSON.stringify({
    projects: [{
      name: 'Incomplete stop fixture',
      type: 'test',
      components: [{
        name: 'stack',
        role: 'fullstack',
        cwd: tempDirectory,
        command: 'this-command-must-not-run',
        stopCommand: `powershell -NoProfile -NonInteractive -Command "Set-Content -LiteralPath '${stopMarker.replaceAll("'", "''")}' -Value attempted"`,
        ports: [workerPort],
        track: 'process',
        match: 'wrapper-that-does-not-exist',
      }],
    }],
  }));

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const manager = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PROJECTS_FILE: configPath,
      PROJECT_MANAGER_DATA_DIR: tempDirectory,
      PROJECT_STOP_VERIFY_TIMEOUT_MS: '300',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  t.after(async () => {
    await Promise.all([stopChild(manager), stopChild(worker)]);
    await removeDirectoryWithRetry(tempDirectory);
  });

  await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/projects`);
    if (!response.ok) return false;
    const payload = await response.json();
    return payload.projects[0].running;
  }, 'fixture process was not detected');

  const response = await fetch(`${baseUrl}/api/projects/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Lair-Token': apiToken(tempDirectory),
    },
    body: JSON.stringify({ name: 'Incomplete stop fixture' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.match(payload.error, /still live/i);
  assert.deepEqual(payload.remaining[0].ports, [workerPort]);
  assert.equal(fs.readFileSync(stopMarker, 'utf8').trim(), 'attempted');

  const afterStop = await fetch(`${baseUrl}/api/projects`).then((result) => result.json());
  assert.equal(afterStop.projects[0].running, true);
});
