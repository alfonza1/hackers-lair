const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  checkInstructionDrift,
  instructionReferences,
} = require('../lib/instruction-drift');

const FIXTURE = path.join(__dirname, 'fixtures', 'instructions', 'broken', 'AGENTS.md');

test('instruction drift extracts path and command references without executing them', () => {
  const references = instructionReferences(
    'Run `npm test` and inspect `scripts/check.js` plus [guide](docs/guide.md).',
  );
  assert.deepEqual(references, [
    { type: 'command', value: 'npm' },
    { type: 'path', value: 'scripts/check.js' },
    { type: 'path', value: 'docs/guide.md' },
  ]);
});

test('instruction drift flags dead paths and missing commands while keeping valid files', async () => {
  const result = await checkInstructionDrift(FIXTURE, {
    commandExists: async (command) => command !== 'missing-tool',
  });
  assert.deepEqual(result.findings.map((finding) => finding.code), [
    'missing-command',
    'missing-path',
  ]);
  assert.doesNotMatch(JSON.stringify(result.findings), /existing\.txt/);
});
