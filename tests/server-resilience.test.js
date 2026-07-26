const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const failureFixture = path.join(__dirname, 'fixtures', 'runtime-failure.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(check, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = check();
      if (value) return value;
    } catch {
      // The service or file is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function identityRequest(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/api/identity`, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    }).on('error', reject);
  });
}

async function startFailureServer(t, mode) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `lair-${mode}-`));
  const port = await freePort();
  fs.writeFileSync(path.join(dataDirectory, 'projects.json'), '{"projects":[]}');
  const child = spawn(process.execPath, ['--require', failureFixture, path.join(root, 'server.js')], {
    cwd: root,
    env: {
      ...process.env,
      LAIR_TEST_RUNTIME_FAILURE: mode,
      PORT: String(port),
      PROJECT_MANAGER_DATA_DIR: dataDirectory,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });
  await waitFor(
    () => fs.existsSync(path.join(dataDirectory, 'api-token')),
    'service identity was not written',
  );
  return { child, dataDirectory, port };
}

test('an unhandled background rejection is logged while the service stays coherent', async (t) => {
  const service = await startFailureServer(t, 'rejection');
  const runtimeLog = path.join(service.dataDirectory, 'logs', 'runtime-errors.log');
  const logged = await waitFor(
    () => fs.existsSync(runtimeLog) && fs.readFileSync(runtimeLog, 'utf8'),
    'runtime rejection was not logged',
  );
  assert.match(logged, /unhandledRejection/);
  assert.match(logged, /runtime rejection fixture/);
  assert.equal((await identityRequest(service.port)).status, 200);
});

test('an uncaught exception is logged and exits cleanly instead of dying silently', async (t) => {
  const service = await startFailureServer(t, 'exception');
  const [code] = await new Promise((resolve) => {
    service.child.once('exit', (...result) => resolve(result));
  });
  assert.equal(code, 1);
  const runtimeLog = fs.readFileSync(
    path.join(service.dataDirectory, 'logs', 'runtime-errors.log'),
    'utf8',
  );
  assert.match(runtimeLog, /uncaughtException/);
  assert.match(runtimeLog, /runtime exception fixture/);
  assert.equal(fs.existsSync(path.join(service.dataDirectory, 'api-token')), false);
});
