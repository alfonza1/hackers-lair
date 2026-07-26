const assert = require('node:assert/strict');
const test = require('node:test');

const {
  describeProjectPortConflicts,
  findProjectPortConflicts,
} = require('../lib/project-port-conflicts');

function project(port, additionalPorts = []) {
  return {
    components: [{
      port,
      uiPorts: additionalPorts,
    }],
  };
}

test('reports the application occupying a new project port', () => {
  const conflicts = findProjectPortConflicts({
    project: project(5173, [4100]),
    listeners: [{
      pid: 4812,
      label: 'Vite development server',
      name: 'node.exe',
      protected: false,
      ports: [{ port: 5173 }, { port: 5173 }],
    }],
  });

  assert.deepEqual(conflicts, [{
    port: 5173,
    pid: 4812,
    name: 'Vite development server',
    protected: false,
  }]);
  assert.match(describeProjectPortConflicts(conflicts), /port 5173.*Vite development server.*PID 4812/i);
});

test('checks every supported project port field', () => {
  const conflicts = findProjectPortConflicts({
    project: {
      components: [{
        ports: [3000],
        uiPorts: [3001],
        backendPorts: [8000],
      }],
    },
    listeners: [
      { pid: 1, name: 'first', ports: [{ port: 3000 }] },
      { pid: 2, name: 'second', ports: [{ port: 3001 }] },
      { pid: 3, name: 'third', ports: [{ port: 8000 }] },
    ],
  });

  assert.deepEqual(conflicts.map(({ port }) => port), [3000, 3001, 8000]);
});

test('does not flag unchanged ports while editing a running project', () => {
  const conflicts = findProjectPortConflicts({
    originalProject: project(5173),
    project: project(5173, [4173]),
    listeners: [
      { pid: 20, name: 'current project', ports: [{ port: 5173 }] },
      { pid: 21, name: 'another application', ports: [{ port: 4173 }] },
    ],
  });

  assert.deepEqual(conflicts, [{
    port: 4173,
    pid: 21,
    name: 'another application',
    protected: false,
  }]);
});
