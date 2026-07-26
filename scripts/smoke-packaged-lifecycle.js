const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const platformFolder = process.platform === 'win32'
  ? "Hacker's Lair-win32-x64"
  : "Hacker's Lair-linux-x64";
const executable = process.platform === 'win32'
  ? path.join(root, 'out', platformFolder, 'HackersLair.exe')
  : path.join(root, 'out', platformFolder, 'hackers-lair');
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hackers-lair-packaged-smoke-'));
const identityFile = path.join(dataDirectory, 'api-token');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForIdentity(deadline) {
  let lastError;
  while (Date.now() < deadline) {
    try {
      const record = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
      const response = await fetch(`http://127.0.0.1:${record.port}/api/identity`, {
        signal: AbortSignal.timeout(1_000),
      });
      const identity = await response.json();
      assert.equal(response.ok, true);
      assert.equal(identity.app, 'hackers-lair');
      assert.equal(identity.nonce, record.nonce);
      return record;
    } catch (error) {
      lastError = error;
      await delay(150);
    }
  }
  throw lastError || new Error('Packaged service identity was not created.');
}

async function waitForExit(child, deadline) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Packaged desktop did not exit.')), deadline - Date.now());
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

async function main() {
  assert.equal(fs.existsSync(executable), true, `Package the app first; missing ${executable}`);
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      PROJECT_MANAGER_DATA_DIR: dataDirectory,
      LAIR_SMOKE_EXIT_AFTER_MS: '1800',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    const record = await waitForIdentity(Date.now() + 15_000);
    assert.equal(record.pid > 0, true);
    assert.equal(await waitForExit(child, Date.now() + 15_000), 0);
    await delay(250);
    assert.throws(() => process.kill(record.pid, 0));
    assert.equal(fs.existsSync(identityFile), false);
    console.log(`Packaged lifecycle passed on ${process.platform}: verified service PID ${record.pid} stopped.`);
  } finally {
    if (child.exitCode === null) child.kill();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
