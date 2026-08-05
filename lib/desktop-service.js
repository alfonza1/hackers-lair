const fs = require('fs');
const path = require('path');

const APP_ID = 'hackers-lair';
const DEFAULT_STOP_TIMEOUT_MS = 3_000;
const DEFAULT_RESTART_BASE_MS = 500;
const DEFAULT_RESTART_MAX_MS = 8_000;
const DEFAULT_RESTART_COOLDOWN_MS = 60_000;
const DEFAULT_RESTART_STABILITY_MS = 30_000;
const DEFAULT_HEALTH_FAILURE_THRESHOLD = 3;

function positiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class ServiceRecoveryPolicy {
  constructor({
    healthFailureThreshold = DEFAULT_HEALTH_FAILURE_THRESHOLD,
    maxRestartAttempts = 5,
    restartBaseMs = DEFAULT_RESTART_BASE_MS,
    restartMaxMs = DEFAULT_RESTART_MAX_MS,
    restartCooldownMs = DEFAULT_RESTART_COOLDOWN_MS,
    restartStabilityMs = DEFAULT_RESTART_STABILITY_MS,
  } = {}) {
    this.healthFailureThreshold = positiveInteger(
      healthFailureThreshold,
      DEFAULT_HEALTH_FAILURE_THRESHOLD,
    );
    this.maxRestartAttempts = positiveInteger(maxRestartAttempts, 5);
    this.restartBaseMs = positiveInteger(restartBaseMs, DEFAULT_RESTART_BASE_MS);
    this.restartMaxMs = positiveInteger(restartMaxMs, DEFAULT_RESTART_MAX_MS);
    this.restartCooldownMs = positiveInteger(restartCooldownMs, DEFAULT_RESTART_COOLDOWN_MS);
    this.restartStabilityMs = positiveInteger(restartStabilityMs, DEFAULT_RESTART_STABILITY_MS);
    this.consecutiveHealthFailures = 0;
    this.restartAttempts = 0;
    this.healthySince = 0;
  }

  markConnected(now = Date.now()) {
    this.consecutiveHealthFailures = 0;
    this.healthySince = now;
  }

  recordHealthSuccess(now = Date.now()) {
    this.consecutiveHealthFailures = 0;
    if (
      this.restartAttempts > 0
      && this.healthySince > 0
      && now - this.healthySince >= this.restartStabilityMs
    ) {
      this.restartAttempts = 0;
    }
    return { restartAttempts: this.restartAttempts };
  }

  recordHealthFailure() {
    this.consecutiveHealthFailures += 1;
    return {
      consecutiveFailures: this.consecutiveHealthFailures,
      shouldRestart: this.consecutiveHealthFailures >= this.healthFailureThreshold,
    };
  }

  nextRestartPlan() {
    const coolingDown = this.restartAttempts >= this.maxRestartAttempts;
    if (coolingDown) this.restartAttempts = 0;
    this.restartAttempts += 1;
    return {
      attempt: this.restartAttempts,
      maxAttempts: this.maxRestartAttempts,
      delayMs: coolingDown
        ? this.restartCooldownMs
        : restartBackoffDelay(
          this.restartAttempts,
          this.restartBaseMs,
          this.restartMaxMs,
        ),
      coolingDown,
    };
  }
}

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

function restartBackoffDelay(
  attempt,
  baseMs = DEFAULT_RESTART_BASE_MS,
  maxMs = DEFAULT_RESTART_MAX_MS,
) {
  const retry = Math.max(1, Math.floor(Number(attempt) || 1));
  return Math.min(maxMs, baseMs * (2 ** (retry - 1)));
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
  ServiceRecoveryPolicy,
  desktopDataDirectory,
  readIdentityRecord,
  restartBackoffDelay,
  stopManagedChild,
  waitForExit,
  writeManagedCliShim,
};
