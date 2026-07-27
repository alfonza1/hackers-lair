const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MAX_FRICTION_TEXT_LENGTH = 2000;
const MAX_FRICTION_LOG_BYTES = 5 * 1024 * 1024;
const TAG_STOPWORDS = new Set([
  'a', 'agent', 'an', 'and', 'did', 'for', 'in', 'on', 'port', 'that', 'the',
  'this', 'to', 'was',
]);

function normalizeFrictionTag(text) {
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/[a-z]:\\[^\s]+/gi, ' path ')
    .replace(/\/(?:[^\s/]+\/)+[^\s/]+/g, ' path ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !TAG_STOPWORDS.has(token));
  return [...new Set(tokens)].slice(0, 8).join('-') || 'uncategorized';
}

function appendFriction(file, {
  text,
  project = '',
  now = new Date(),
} = {}) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) throw new Error('Friction text is required.');
  if (normalizedText.length > MAX_FRICTION_TEXT_LENGTH) {
    throw new Error(`Friction text must be ${MAX_FRICTION_TEXT_LENGTH} characters or fewer.`);
  }
  const event = {
    id: crypto.randomUUID(),
    text: normalizedText,
    project: String(project || '').trim().slice(0, 200),
    tag: normalizeFrictionTag(normalizedText),
    ts: now.toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  return event;
}

function validFrictionEvent(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof value.id === 'string'
    && typeof value.text === 'string'
    && value.text
    && typeof value.tag === 'string'
    && value.tag
    && Number.isFinite(Date.parse(value.ts)),
  );
}

async function listFriction(file) {
  let stat;
  try { stat = fs.statSync(file); } catch (error) {
    if (error.code === 'ENOENT') return { entries: [], groups: [], malformedLines: 0 };
    throw error;
  }
  const start = Math.max(0, stat.size - MAX_FRICTION_LOG_BYTES);
  const stream = fs.createReadStream(file, { encoding: 'utf8', start });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const entries = [];
  let malformedLines = 0;
  let skipPartial = start > 0;
  for await (const line of lines) {
    if (skipPartial) {
      skipPartial = false;
      continue;
    }
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (!validFrictionEvent(parsed)) {
        malformedLines += 1;
        continue;
      }
      entries.push(parsed);
    } catch {
      malformedLines += 1;
    }
  }
  entries.sort((left, right) => right.ts.localeCompare(left.ts));
  const byTag = new Map();
  for (const entry of entries) {
    const group = byTag.get(entry.tag) || {
      tag: entry.tag,
      count: 0,
      lastSeenAt: entry.ts,
      example: entry.text,
      project: entry.project || '',
      nudge: false,
    };
    group.count += 1;
    if (entry.ts > group.lastSeenAt) {
      group.lastSeenAt = entry.ts;
      group.example = entry.text;
      group.project = entry.project || '';
    }
    group.nudge = group.count >= 3;
    byTag.set(entry.tag, group);
  }
  const groups = [...byTag.values()].sort((left, right) => (
    right.count - left.count || right.lastSeenAt.localeCompare(left.lastSeenAt)
  ));
  return { entries, groups, malformedLines };
}

module.exports = {
  MAX_FRICTION_LOG_BYTES,
  MAX_FRICTION_TEXT_LENGTH,
  appendFriction,
  listFriction,
  normalizeFrictionTag,
};
