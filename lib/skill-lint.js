const fs = require('fs');
const path = require('path');

const DESCRIPTION_MIN_LENGTH = 20;
const DESCRIPTION_MAX_LENGTH = 1024;
const ROUTING_COLLISION_THRESHOLD = 0.62;
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'use', 'when', 'with',
]);
const LEVEL_WEIGHT = { ok: 0, warn: 1, error: 2 };

function frontmatterValue(source, name) {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return '';
  const field = match[1].match(new RegExp(`^${name}:\\s*(.*)$`, 'm'));
  if (!field) return '';
  const value = field[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function markdownBody(source) {
  return source.replace(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
}

function significantTokens(value) {
  return [...new Set(String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/(?:ing|ed|es|s)$/i, ''))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token)))];
}

function descriptionSimilarity(left, right) {
  const leftTokens = significantTokens(left);
  const rightTokens = significantTokens(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token)).length;
  const tokenRatio = shared / Math.max(leftTokens.length, rightTokens.length);
  const normalizedLeft = String(left || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedRight = String(right || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const phraseBoost = normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft)
    ? 0.15
    : 0;
  return Math.min(1, tokenRatio + phraseBoost);
}

function referencedRelativePaths(body) {
  const references = [];
  const markdownLinks = body.matchAll(/\]\(([^)]+)\)/g);
  for (const match of markdownLinks) references.push(match[1]);
  const codeSpans = body.matchAll(/`([^`\r\n]+)`/g);
  for (const match of codeSpans) {
    if (/^(?:\.{1,2}[\\/]|(?:scripts|references|assets)[\\/])/.test(match[1])) {
      references.push(match[1]);
    }
  }
  return [...new Set(references
    .map((value) => value.trim().replace(/^<|>$/g, '').split(/[?#]/)[0])
    .filter((value) => (
      value
      && !path.isAbsolute(value)
      && !/^(?:[a-z]+:|#)/i.test(value)
    )))];
}

function lintLevel(findings) {
  return findings.reduce(
    (level, finding) => (
      LEVEL_WEIGHT[finding.level] > LEVEL_WEIGHT[level] ? finding.level : level
    ),
    'ok',
  );
}

function lintSkill({ directory, skillFile = path.join(directory, 'SKILL.md') }) {
  const findings = [];
  let source = '';
  try {
    source = fs.readFileSync(skillFile, 'utf8');
  } catch (error) {
    return {
      level: 'error',
      findings: [{
        code: 'missing-skill-file',
        level: 'error',
        message: `SKILL.md could not be read: ${error.message}`,
      }],
    };
  }

  const name = frontmatterValue(source, 'name');
  const description = frontmatterValue(source, 'description');
  if (!description) {
    findings.push({
      code: 'description-missing',
      level: 'error',
      message: 'Frontmatter description is missing or empty.',
    });
  } else if (description.length < DESCRIPTION_MIN_LENGTH) {
    findings.push({
      code: 'description-short',
      level: 'warn',
      message: `Description is ${description.length} characters; use at least ${DESCRIPTION_MIN_LENGTH}.`,
    });
  } else if (description.length > DESCRIPTION_MAX_LENGTH) {
    findings.push({
      code: 'description-long',
      level: 'error',
      message: `Description exceeds ${DESCRIPTION_MAX_LENGTH} characters.`,
    });
  }

  const folderName = path.basename(directory);
  if (!name || name !== folderName) {
    findings.push({
      code: 'name-folder-mismatch',
      level: name ? 'warn' : 'error',
      message: name
        ? `Frontmatter name "${name}" does not match folder "${folderName}".`
        : 'Frontmatter name is missing.',
    });
  }

  for (const reference of referencedRelativePaths(markdownBody(source))) {
    if (!fs.existsSync(path.resolve(directory, reference))) {
      findings.push({
        code: 'missing-reference',
        level: 'error',
        message: `Referenced path does not exist: ${reference}`,
        reference,
      });
    }
  }

  return { level: lintLevel(findings), findings };
}

function routingCollisions(skills, threshold = ROUTING_COLLISION_THRESHOLD) {
  const collisions = new Map(skills.map((skill) => [skill.id, []]));
  for (let left = 0; left < skills.length; left += 1) {
    for (let right = left + 1; right < skills.length; right += 1) {
      const score = descriptionSimilarity(skills[left].description, skills[right].description);
      if (score < threshold) continue;
      collisions.get(skills[left].id).push({ skill: skills[right].name, score });
      collisions.get(skills[right].id).push({ skill: skills[left].name, score });
    }
  }
  return collisions;
}

function lintSkills(skills, { collisionThreshold = ROUTING_COLLISION_THRESHOLD } = {}) {
  const results = new Map();
  const collisions = routingCollisions(skills, collisionThreshold);
  for (const skill of skills) {
    const result = skill.skillFile && skill.directory
      ? lintSkill(skill)
      : { level: 'ok', findings: [] };
    const overlapFindings = (collisions.get(skill.id) || []).map((collision) => ({
      code: 'routing-overlap',
      level: 'warn',
      message: `Routing description overlaps with ${collision.skill} (${Math.round(collision.score * 100)}%).`,
      relatedSkill: collision.skill,
      score: collision.score,
    }));
    const findings = [...result.findings, ...overlapFindings];
    results.set(skill.id, { level: lintLevel(findings), findings });
  }
  return results;
}

module.exports = {
  DESCRIPTION_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  ROUTING_COLLISION_THRESHOLD,
  descriptionSimilarity,
  lintSkill,
  lintSkills,
  referencedRelativePaths,
  routingCollisions,
  significantTokens,
};
