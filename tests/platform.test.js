const assert = require('node:assert/strict');
const test = require('node:test');

const { parseNetstat, parseTasklist } = require('../lib/platform/win32');
const { cpuTimeSeconds, parsePs, parseSs } = require('../lib/platform/linux');

test('Win32 fixtures map listeners, connections, names, and memory', () => {
  const tasklist = [
    '"node.exe","4120","Console","1","123,456 K"',
    '"System","4","Services","0","1,024 K"',
  ].join('\r\n');
  const netstat = [
    '  TCP    127.0.0.1:5173     0.0.0.0:0       LISTENING       4120',
    '  TCP    127.0.0.1:5173     127.0.0.1:60211 ESTABLISHED     4120',
  ].join('\r\n');

  const processes = parseTasklist(tasklist);
  const network = parseNetstat(netstat);
  assert.equal(processes.get(4120).name, 'node.exe');
  assert.equal(processes.get(4120).memKB, 123456);
  assert.deepEqual([...network.listeners.get(4120).get(5173)], ['127.0.0.1']);
  assert.equal(network.establishedByPort.get(5173), 1);
});

test('Linux fixtures map ss listeners and ps process telemetry', () => {
  const ss = [
    'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=812,fd=20))',
    'ESTAB 0 0 127.0.0.1:3000 127.0.0.1:48812 users:(("node",pid=812,fd=21))',
  ].join('\n');
  const network = parseSs(ss);
  assert.equal(network.listeners.get(812).name, 'node');
  assert.deepEqual([...network.listeners.get(812).ports.get(3000)], ['127.0.0.1']);
  assert.equal(network.establishedByPort.get(3000), 1);

  const now = Date.UTC(2026, 0, 1);
  const [process] = parsePs(' 812 node 204800 65 00:01:05 node server.js --port 3000', now);
  assert.equal(process.pid, 812);
  assert.equal(process.workingSetKB, 204800);
  assert.equal(process.uptimeSeconds, 65);
  assert.equal(process.cpuTimeSeconds, 65);
  assert.equal(process.cmd, 'node server.js --port 3000');
});

test('Linux CPU time parser supports day-prefixed values', () => {
  assert.equal(cpuTimeSeconds('01:02:03'), 3723);
  assert.equal(cpuTimeSeconds('2-01:00:00'), 176400);
});
