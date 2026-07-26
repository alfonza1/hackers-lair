const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { listPackage } = require('@electron/asar');
const { PACKAGED_NODE_MODULES } = require('../forge.config');

const root = path.resolve(__dirname, '..');
const platformFolder = process.platform === 'win32'
  ? "Hacker's Lair-win32-x64"
  : "Hacker's Lair-linux-x64";
const executable = process.platform === 'win32'
  ? path.join(root, 'out', platformFolder, 'HackersLair.exe')
  : path.join(root, 'out', platformFolder, 'HackersLair');
const appArchive = path.join(root, 'out', platformFolder, 'resources', 'app.asar');
const chromiumNotices = path.join(root, 'out', platformFolder, 'LICENSES.chromium.html');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function packagedLaunchArguments(platform = process.platform, environment = process.env) {
  if (platform === 'linux' && environment.LAIR_SMOKE_DISABLE_SANDBOX === '1') {
    return ['--no-sandbox'];
  }
  return [];
}

function packagedLifecycleAttempts(platform = process.platform) {
  return platform === 'linux' ? 2 : 1;
}

function terminateServiceUnexpectedly(pid) {
  if (process.platform === 'win32') {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  process.kill(pid, 'SIGKILL');
}

async function waitForIdentity(deadline, child, output, identityFile, previousIdentity = null) {
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Packaged desktop exited with code ${child.exitCode} before starting its service.`
        + `${output.text ? `\n${output.text.trim()}` : ''}`,
      );
    }
    try {
      const record = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
      const response = await fetch(`http://127.0.0.1:${record.port}/api/identity`, {
        signal: AbortSignal.timeout(1_000),
      });
      const identity = await response.json();
      assert.equal(response.ok, true);
      assert.equal(identity.app, 'hackers-lair');
      assert.equal(identity.nonce, record.nonce);
      if (
        previousIdentity
        && (record.pid === previousIdentity.pid || record.nonce === previousIdentity.nonce)
      ) {
        throw new Error('The packaged desktop has not replaced the stopped service yet.');
      }
      return record;
    } catch (error) {
      lastError = error;
      await delay(150);
    }
  }
  throw new Error(
    `Packaged service identity was not created: ${lastError?.message || 'timed out'}.`
    + `${output.text ? `\n${output.text.trim()}` : ''}`,
  );
}

async function waitForDesktopReady(deadline, child, output, readyFile) {
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Packaged desktop exited with code ${child.exitCode} before finishing initialization.`
        + `${output.text ? `\n${output.text.trim()}` : ''}`,
      );
    }
    if (fs.existsSync(readyFile)) return;
    await delay(100);
  }
  throw new Error(
    'Packaged desktop did not finish initialization before the deadline.'
    + `${output.text ? `\n${output.text.trim()}` : ''}`,
  );
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

async function removeDirectoryWithRetry(directory) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM'].includes(error.code) || attempt === 9) throw error;
      await delay(100);
    }
  }
}

function readIdentityPid(identityFile) {
  try {
    const pid = Number(JSON.parse(fs.readFileSync(identityFile, 'utf8')).pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function forceTerminatePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch (error) {
    let processStillExists = true;
    try {
      process.kill(pid, 0);
    } catch (lookupError) {
      processStillExists = !['ESRCH', 'EINVAL'].includes(lookupError.code);
    }
    if (processStillExists && !['ESRCH', 'EINVAL'].includes(error.code)) {
      console.warn(`Could not force-stop smoke process ${pid}: ${error.message}`);
    }
  }
}

async function forceTerminateDesktop(child, identityFile) {
  const servicePid = readIdentityPid(identityFile);
  if (child.exitCode === null) forceTerminatePid(child.pid);
  if (servicePid !== child.pid) forceTerminatePid(servicePid);
  try {
    await waitForExit(child, Date.now() + 5_000);
  } catch {
    // The process tree has already received an unconditional kill.
  }
}

function assertPackageContents() {
  assert.equal(fs.existsSync(executable), true, `Package the app first; missing ${executable}`);
  assert.equal(
    fs.existsSync(chromiumNotices),
    true,
    'The package must include Chromium third-party notices.',
  );
  const packagedFiles = listPackage(appArchive).map((file) => file.replaceAll('\\', '/'));
  assert.ok(
    packagedFiles.includes('/THIRD_PARTY_NOTICES.txt'),
    'The package must include JavaScript dependency notices.',
  );
  const forbiddenRoots = [
    '/.github',
    '/distribution',
    '/docs',
    '/install.ps1',
    '/scripts',
    '/site',
    '/TESTING.md',
    '/tests',
    '/uninstall.ps1',
  ];
  for (const forbiddenRoot of forbiddenRoots) {
    assert.equal(
      packagedFiles.some((file) => file === forbiddenRoot || file.startsWith(`${forbiddenRoot}/`)),
      false,
      `Packaged runtime contains repository-only path ${forbiddenRoot}.`,
    );
  }
  const packagedModules = new Set(packagedFiles
    .filter((file) => file.startsWith('/node_modules/'))
    .map((file) => {
      const segments = file.split('/');
      return segments[2].startsWith('@')
        ? `${segments[2]}/${segments[3]}`
        : segments[2];
    }));
  assert.deepEqual(
    [...packagedModules].sort(),
    [...PACKAGED_NODE_MODULES].sort(),
    'Packaged runtime dependency allowlist does not match app.asar.',
  );
}

async function runLifecycleAttempt(attempt) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hackers-lair-packaged-smoke-'));
  const identityFile = path.join(dataDirectory, 'api-token');
  const readyFile = path.join(dataDirectory, 'desktop-smoke-ready');
  const output = { text: '' };
  const child = spawn(executable, packagedLaunchArguments(), {
    env: {
      ...process.env,
      PROJECT_MANAGER_DATA_DIR: dataDirectory,
      LAIR_SMOKE_EXIT_AFTER_MS: '30000',
      LAIR_SMOKE_EXIT_AFTER_RECOVERY_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      output.text = `${output.text}${chunk}`.slice(-16_384);
      if (process.env.LAIR_SMOKE_VERBOSE === '1') process.stderr.write(chunk);
    });
  }
  try {
    const firstRecord = await waitForIdentity(Date.now() + 15_000, child, output, identityFile);
    await waitForDesktopReady(Date.now() + 15_000, child, output, readyFile);
    assert.equal(firstRecord.pid > 0, true);
    terminateServiceUnexpectedly(firstRecord.pid);
    const recoveredRecord = await waitForIdentity(
      Date.now() + 30_000,
      child,
      output,
      identityFile,
      firstRecord,
    );
    assert.notEqual(recoveredRecord.pid, firstRecord.pid);
    assert.equal(await waitForExit(child, Date.now() + 15_000), 0);
    await delay(250);
    assert.throws(() => process.kill(firstRecord.pid, 0));
    assert.throws(() => process.kill(recoveredRecord.pid, 0));
    assert.equal(fs.existsSync(identityFile), false);
    console.log(
      `Packaged lifecycle passed on ${process.platform} (attempt ${attempt}): service PID ${firstRecord.pid}`
      + ` recovered as ${recoveredRecord.pid}, then stopped cleanly.`,
    );
  } finally {
    await forceTerminateDesktop(child, identityFile);
    child.stdout.destroy();
    child.stderr.destroy();
    await removeDirectoryWithRetry(dataDirectory);
  }
}

async function main() {
  assertPackageContents();
  const attempts = packagedLifecycleAttempts();
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runLifecycleAttempt(attempt);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(
          `Packaged lifecycle attempt ${attempt}/${attempts} failed; retrying cleanly:`
          + ` ${error.message}`,
        );
      }
    }
  }
  throw lastError;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { packagedLaunchArguments, packagedLifecycleAttempts };
