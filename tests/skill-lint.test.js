const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  descriptionSimilarity,
  lintSkill,
  lintSkills,
} = require('../lib/skill-lint');

const FIXTURES = path.join(__dirname, 'fixtures', 'skills');

test('skill linter accepts complete frontmatter and existing relative references', () => {
  const result = lintSkill({
    directory: path.join(FIXTURES, 'clean-skill'),
    skillFile: path.join(FIXTURES, 'clean-skill', 'SKILL.md'),
  });
  assert.deepEqual(result, { level: 'ok', findings: [] });
});

test('skill linter accepts a folded YAML description', () => {
  const directory = path.join(FIXTURES, 'folded-description');
  assert.deepEqual(
    lintSkill({
      directory,
      skillFile: path.join(directory, 'SKILL.md'),
    }),
    { level: 'ok', findings: [] },
  );
});

test('skill linter reports weak metadata, folder mismatch, and dead references', () => {
  const result = lintSkill({
    directory: path.join(FIXTURES, 'broken-folder'),
    skillFile: path.join(FIXTURES, 'broken-folder', 'SKILL.md'),
  });
  assert.equal(result.level, 'error');
  assert.deepEqual(result.findings.map((finding) => finding.code), [
    'description-short',
    'name-folder-mismatch',
    'missing-reference',
  ]);
});

test('routing similarity ignores stopwords and merges overlap findings', () => {
  assert.ok(descriptionSimilarity(
    'Review local release readiness and report concrete repository risks.',
    'Review repository release readiness and identify concrete local risks.',
  ) > 0.6);
  assert.ok(descriptionSimilarity(
    'Review repository releases for readiness.',
    'Generate colorful bitmap illustrations.',
  ) < 0.3);

  const skills = [
    {
      id: 'one',
      name: 'release-review',
      description: 'Review local release readiness and report concrete repository risks.',
      directory: path.join(FIXTURES, 'clean-skill'),
      skillFile: path.join(FIXTURES, 'clean-skill', 'SKILL.md'),
    },
    {
      id: 'two',
      name: 'ship-review',
      description: 'Review repository release readiness and identify concrete local risks.',
      directory: path.join(FIXTURES, 'clean-skill'),
      skillFile: path.join(FIXTURES, 'clean-skill', 'SKILL.md'),
    },
  ];
  const results = lintSkills(skills);
  assert.match(
    results.get('one').findings.find((finding) => finding.code === 'routing-overlap').message,
    /ship-review/,
  );
  assert.equal(results.get('one').level, 'warn');
});
