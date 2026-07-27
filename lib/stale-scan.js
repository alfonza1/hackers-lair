const RETIRED_MODEL_PATTERNS = Object.freeze([
  /\bclaude-(?:2(?:\.\d+)?|3-(?:opus|sonnet|haiku)(?:-\d{8})?)\b/gi,
  /\bgpt-3(?:\.\d+)?(?:-[a-z0-9-]+)?\b/gi,
]);
const OLD_NODE_PIN = /\bnode(?:\.?js)?\s*(?:v|version\s*)?(16|18)\b/gi;
const DATE_PATTERN = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
const STALE_MONTHS = 18;

function scanStaleContent(source, { now = new Date() } = {}) {
  const text = String(source || '');
  const findings = [];
  for (const pattern of RETIRED_MODEL_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      findings.push({
        code: 'old-model-id',
        level: 'warn',
        message: `Possibly retired model identifier: ${match[0]}`,
        value: match[0],
      });
    }
  }
  for (const match of text.matchAll(OLD_NODE_PIN)) {
    findings.push({
      code: 'old-node-pin',
      level: 'warn',
      message: `Old Node runtime pin may need review: ${match[0]}`,
      value: match[0],
    });
  }
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - STALE_MONTHS);
  for (const match of text.matchAll(DATE_PATTERN)) {
    const date = new Date(`${match[0]}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date >= cutoff) continue;
    findings.push({
      code: 'old-date',
      level: 'warn',
      message: `Date is more than ${STALE_MONTHS} months old: ${match[0]}`,
      value: match[0],
    });
  }
  const unique = new Map();
  for (const finding of findings) unique.set(`${finding.code}:${finding.value}`, finding);
  return [...unique.values()];
}

module.exports = {
  RETIRED_MODEL_PATTERNS,
  STALE_MONTHS,
  scanStaleContent,
};
