const assert = require('node:assert/strict');
const test = require('node:test');

const { compareProjectsForDisplay } = require('../lib/project-order');

test('places every running project before dormant projects', () => {
  const projects = [
    { name: 'recent dormant', running: false, lastStartedAt: 500 },
    { name: 'older live', running: true, lastStartedAt: 100 },
    { name: 'never started', running: false, lastStartedAt: 0 },
    { name: 'newer live', running: true, lastStartedAt: 300 },
  ];

  projects.sort(compareProjectsForDisplay);

  assert.deepEqual(projects.map((project) => project.name), [
    'newer live',
    'older live',
    'recent dormant',
    'never started',
  ]);
});

test('treats missing or invalid start times as never started', () => {
  const projects = [
    { name: 'missing', running: false },
    { name: 'recent', running: false, lastStartedAt: 200 },
    { name: 'invalid', running: false, lastStartedAt: 'unknown' },
  ];

  projects.sort(compareProjectsForDisplay);

  assert.equal(projects[0].name, 'recent');
});
