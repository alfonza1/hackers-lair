const assert = require('node:assert/strict');
const test = require('node:test');

const { compareProjectsForDisplay } = require('../lib/project-order');

test('places every running project before dormant projects', () => {
  const projects = [
    { name: 'recently terminated', running: false, lastStartedAt: 50, lastActionAt: 500 },
    { name: 'older live', running: true, lastStartedAt: 100, lastActionAt: 100 },
    { name: 'never started', running: false, lastStartedAt: 0 },
    { name: 'newer live', running: true, lastStartedAt: 300, lastActionAt: 300 },
    { name: 'older dormant', running: false, lastStartedAt: 400, lastActionAt: 400 },
  ];

  projects.sort(compareProjectsForDisplay);

  assert.deepEqual(projects.map((project) => project.name), [
    'newer live',
    'older live',
    'recently terminated',
    'older dormant',
    'never started',
  ]);
});

test('falls back to start time when activity time is missing or invalid', () => {
  const projects = [
    { name: 'missing', running: false },
    { name: 'recent', running: false, lastStartedAt: 200 },
    { name: 'invalid action', running: false, lastStartedAt: 100, lastActionAt: 'unknown' },
    { name: 'invalid', running: false, lastStartedAt: 'unknown', lastActionAt: 'unknown' },
  ];

  projects.sort(compareProjectsForDisplay);

  assert.equal(projects[0].name, 'recent');
});
