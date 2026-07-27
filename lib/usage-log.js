const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const MAX_USAGE_LOG_BYTES = 5 * 1024 * 1024;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_TYPES = new Set(['skill', 'agent', 'command']);

function resolveAgentsHome({
  agentsHome,
  environment = process.env,
  homeDirectory = os.homedir(),
} = {}) {
  return path.resolve(agentsHome || environment.AGENTS_HOME || path.join(homeDirectory, '.agents'));
}

function validEvent(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && ALLOWED_TYPES.has(value.type)
    && typeof value.name === 'string'
    && value.name.trim()
    && typeof value.project === 'string'
    && typeof value.source === 'string'
    && Number.isFinite(Date.parse(value.ts)),
  );
}

function eventKey(type, name) {
  return `${type}:${String(name).trim().toLowerCase()}`;
}

function updateAggregate(result, event, nowMs) {
  const key = eventKey(event.type, event.name);
  const normalizedTimestamp = new Date(event.ts).toISOString();
  const existing = result.byKey[key] || {
    type: event.type,
    name: event.name.trim(),
    count: 0,
    lastUsedAt: null,
    weeklyBuckets: Array(8).fill(0),
  };
  existing.count += 1;
  if (!existing.lastUsedAt || normalizedTimestamp > existing.lastUsedAt) {
    existing.lastUsedAt = normalizedTimestamp;
  }
  const weeksAgo = Math.floor((nowMs - Date.parse(normalizedTimestamp)) / WEEK_MS);
  if (weeksAgo >= 0 && weeksAgo < 8) {
    existing.weeklyBuckets[7 - weeksAgo] += 1;
  }
  result.byKey[key] = existing;
  result.events += 1;
  if (!result.logStartedAt || normalizedTimestamp < result.logStartedAt) {
    result.logStartedAt = normalizedTimestamp;
  }
}

function tailStartsOnLineBoundary(file, start) {
  if (start === 0) return true;
  const descriptor = fs.openSync(file, 'r');
  try {
    const previous = Buffer.alloc(1);
    fs.readSync(descriptor, previous, 0, 1, start - 1);
    return previous[0] === 0x0a;
  } finally {
    fs.closeSync(descriptor);
  }
}

async function aggregateUsageLog(file, {
  now = new Date(),
  maxBytes = MAX_USAGE_LOG_BYTES,
} = {}) {
  const result = {
    byKey: {},
    bytesRead: 0,
    events: 0,
    logStartedAt: null,
    malformedLines: 0,
  };
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  if (!stat.isFile()) return result;
  const fileStartedAt = Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0
    ? stat.birthtimeMs
    : stat.ctimeMs;
  if (Number.isFinite(fileStartedAt) && fileStartedAt > 0) {
    result.logStartedAt = new Date(fileStartedAt).toISOString();
  }
  if (stat.size === 0) return result;

  const cappedBytes = Math.max(1, Math.min(Number(maxBytes) || MAX_USAGE_LOG_BYTES, MAX_USAGE_LOG_BYTES));
  const start = Math.max(0, stat.size - cappedBytes);
  result.bytesRead = stat.size - start;
  let skipFirstLine = !tailStartsOnLineBoundary(file, start);
  const stream = fs.createReadStream(file, { encoding: 'utf8', start });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const nowMs = now.getTime();
  for await (const line of lines) {
    if (skipFirstLine) {
      skipFirstLine = false;
      continue;
    }
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (!validEvent(parsed)) {
        result.malformedLines += 1;
        continue;
      }
      updateAggregate(result, parsed, nowMs);
    } catch {
      result.malformedLines += 1;
    }
  }
  return result;
}

function isColdUsage({
  usage,
  logStartedAt,
  coldSkillDays,
  now = new Date(),
}) {
  const thresholdMs = Math.max(1, Number(coldSkillDays) || 45) * 24 * 60 * 60 * 1000;
  const comparison = usage?.lastUsedAt || logStartedAt;
  if (!comparison) return false;
  return now.getTime() - Date.parse(comparison) >= thresholdMs;
}

async function pruneOlderThan(file, days, { now = new Date() } = {}) {
  const cutoff = now.getTime() - Math.max(1, Number(days) || 1) * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(file)) return { kept: 0, removed: 0 };
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  const output = fs.createWriteStream(temporary, { encoding: 'utf8', mode: 0o600 });
  let kept = 0;
  let removed = 0;
  try {
    const lines = readline.createInterface({
      input: fs.createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let shouldKeep = true;
      try {
        const parsed = JSON.parse(line);
        if (validEvent(parsed) && Date.parse(parsed.ts) < cutoff) shouldKeep = false;
      } catch {
        // Malformed lines are retained so compaction never destroys unknown data.
      }
      if (shouldKeep) {
        output.write(`${line}\n`);
        kept += 1;
      } else {
        removed += 1;
      }
    }
    await new Promise((resolve, reject) => {
      output.end(resolve);
      output.on('error', reject);
    });
    fs.renameSync(temporary, file);
    return { kept, removed };
  } catch (error) {
    output.destroy();
    try { fs.unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}

module.exports = {
  MAX_USAGE_LOG_BYTES,
  aggregateUsageLog,
  eventKey,
  isColdUsage,
  pruneOlderThan,
  resolveAgentsHome,
};
