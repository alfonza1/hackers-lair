const fs = require('fs');
const path = require('path');

const APP_ID = 'hackers-lair';
const DEFAULT_STOP_TIMEOUT_MS = 3_000;

function desktopDataDirectory(electronApp, environment = process.env) {
  return environment.PROJECT_MANAGER_DATA_DIR || electronApp.getPath('userData');
}

function writeManagedCliShim(file, content, marker) {
  if (!String(content).includes(marker)) {
    throw new Error('Managed CLI content must include its ownership marker.');
  }
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(marker)) {
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o755 });
  fs.renameSync(temporary, file);
  return true;
}

function readIdentityRecord(file, expectedPid = null) {
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const port = Number(record.port);
  const pid = Number(record.pid);
  if (
    record.app !== APP_ID
    || !record.token
    || !record.nonce
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
    || !Number.isInteger(pid)
    || pid < 1
    || (expectedPid !== null && pid !== expectedPid)
  ) {
    throw new Error('The local identity record is invalid.');
  }
  return { ...record, port, pid };
}

function waitForExit(child, timeoutMs = DEFAULT_STOP_TIMEOUT_MS) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    child.once('exit', onExit);
  });
}

async function stopManagedChild(child, timeoutMs = DEFAULT_STOP_TIMEOUT_MS) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (await waitForExit(child, timeoutMs)) return;
  child.kill('SIGKILL');
  await waitForExit(child, 1_000);
}

module.exports = {
  APP_ID,
  desktopDataDirectory,
  readIdentityRecord,
  stopManagedChild,
  waitForExit,
  writeManagedCliShim,
};
