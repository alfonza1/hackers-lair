const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { instantiateTemplate, PROJECT_TEMPLATES } = require('../lib/project-templates');
const { redactText, redactValue } = require('../lib/redaction');
const { defaultDataDirectory, findProject } = require('../bin/lair');
const {
  extractLocalUrls,
  isZombieComponent,
  splitTargetUrls,
} = require('../lib/runtime-intelligence');

test('project templates produce portable offline launch entries', () => {
  const folder = path.resolve('fixture-vite');
  const project = instantiateTemplate({
    templateId: 'vite',
    name: 'Fixture UI',
    folder,
    port: 4173,
  });
  assert.equal(project.name, 'Fixture UI');
  assert.equal(project.components[0].cwd, folder);
  assert.equal(project.components[0].port, 4173);
  assert.match(project.components[0].command, /4173/);
  assert.deepEqual(
    PROJECT_TEMPLATES.map((template) => template.id),
    ['vite', 'nextjs', 'spring-boot', 'fastapi', 'compose'],
  );
  assert.throws(
    () => instantiateTemplate({ templateId: 'vite', name: 'Missing folder', folder: '' }),
    /folder is required/i,
  );
});

test('support exports redact usernames and absolute machine paths recursively', () => {
  const home = os.homedir();
  const username = process.env.USERNAME || path.basename(home);
  const input = {
    cwd: path.join(home, 'Desktop', 'Code', 'secret-project'),
    message: `Owner ${username} launched C:\\private\\workspace\\server.js`,
  };
  const output = redactValue(input);
  const serialized = JSON.stringify(output);
  assert.doesNotMatch(serialized, new RegExp(username, 'i'));
  assert.doesNotMatch(serialized, /C:\\\\private\\\\workspace/i);
  assert.match(redactText(input.cwd), /%USERPROFILE%/);
  assert.equal(
    redactText('cwd=/srv/development/private-api/server.js'),
    'cwd=<PATH>/server.js',
  );
});

test('CLI project matching rejects ambiguous partial names', () => {
  const projects = [{ name: 'api server' }, { name: 'api worker' }, { name: 'web' }];
  assert.equal(findProject(projects, 'WEB').name, 'web');
  assert.throws(() => findProject(projects, 'api'), /ambiguous.*api server.*api worker/i);
  assert.equal(findProject(projects, 'missing'), undefined);
});

test('runtime intelligence accepts local announced URLs and rejects unsafe or invalid ones', () => {
  assert.deepEqual(extractLocalUrls([
    'ready at http://localhost:5173/',
    'api http://127.0.0.1:8000/docs).',
    'external https://example.com:443/',
    'invalid http://localhost:99999/',
  ].join('\n')), [
    'http://localhost:5173/',
    'http://127.0.0.1:8000/docs',
  ]);
  assert.equal(isZombieComponent({
    running: true,
    uptimeSeconds: 9 * 3600,
    establishedConnections: 0,
    thresholdHours: 8,
  }), true);
  assert.equal(isZombieComponent({
    running: true,
    uptimeSeconds: 9 * 3600,
    establishedConnections: 1,
    thresholdHours: 8,
  }), false);
});

test('CLI identity follows platform user-data conventions', () => {
  assert.equal(
    defaultDataDirectory({
      environment: { APPDATA: 'C:\\Profile\\Roaming' },
      platform: 'win32',
      homeDirectory: 'C:\\Profile',
    }),
    path.join('C:\\Profile\\Roaming', 'HackersLair'),
  );
  assert.equal(
    defaultDataDirectory({
      environment: { XDG_CONFIG_HOME: '/tmp/config' },
      platform: 'linux',
      homeDirectory: '/home/dev',
    }),
    path.join('/tmp/config', 'HackersLair'),
  );
});

test('target URLs separate live detections from dormant configured ports', () => {
  assert.deepEqual(splitTargetUrls({
    active: false,
    configuredPorts: [3000, 8000],
    livePorts: [],
    logUrls: ['http://localhost:3000/'],
  }), {
    detectedUrls: [],
    configuredPorts: [3000, 8000],
  });

  assert.deepEqual(splitTargetUrls({
    active: true,
    configuredPorts: [3000, 8000],
    livePorts: [3000],
    logUrls: ['http://localhost:3000/dashboard'],
  }), {
    detectedUrls: [
      'http://localhost:3000/dashboard',
      'http://localhost:3000',
    ],
    configuredPorts: [8000],
  });
});
