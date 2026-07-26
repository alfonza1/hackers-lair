const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { instantiateTemplate, PROJECT_TEMPLATES } = require('../lib/project-templates');
const { redactText, redactValue } = require('../lib/redaction');

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
});
