#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDirectory = process.env.PROJECT_MANAGER_DATA_DIR
  || (process.env.APPDATA
    ? path.join(process.env.APPDATA, 'HackersLair')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'HackersLair'));
const identityFile = path.join(dataDirectory, 'api-token');

function usage() {
  console.log([
    'Hacker\'s Lair CLI',
    '',
    '  lair ls',
    '  lair start <project>',
    '  lair stop <project>',
    '  lair open <project>',
    '  lair doctor',
    '  lair backups',
    '  lair restore <backup-file>',
  ].join('\n'));
}

function loadIdentity() {
  try {
    const identity = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
    if (identity.app !== 'hackers-lair' || !identity.token || !identity.nonce || !identity.port) {
      throw new Error('invalid identity');
    }
    return identity;
  } catch {
    throw new Error(`Hacker's Lair is not running or ${identityFile} is unavailable.`);
  }
}

async function client() {
  const identity = loadIdentity();
  const baseUrl = `http://127.0.0.1:${identity.port}`;
  const proof = await fetch(`${baseUrl}/api/identity`, { signal: AbortSignal.timeout(2_500) });
  const actual = proof.ok ? await proof.json() : {};
  if (actual.app !== identity.app || actual.nonce !== identity.nonce) {
    throw new Error('The recorded local service identity could not be verified.');
  }
  async function request(endpoint, body) {
    const response = await fetch(`${baseUrl}${endpoint}`, body === undefined ? {} : {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Lair-Token': identity.token,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }
  return { request };
}

function findProject(projects, query) {
  const normalized = String(query || '').toLowerCase();
  return projects.find((project) => project.name.toLowerCase() === normalized)
    || projects.find((project) => project.name.toLowerCase().includes(normalized));
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (['help', '--help', '-h'].includes(command)) {
    usage();
    return;
  }
  const { request } = await client();
  if (command === 'ls') {
    const { projects } = await request('/api/projects');
    for (const project of projects) {
      console.log(`${project.running ? 'LIVE' : project.errored ? 'ERROR' : 'DOWN'}\t${project.name}`);
    }
    return;
  }
  if (command === 'doctor') {
    const report = await request('/api/doctor/report');
    console.log(report.report);
    return;
  }
  if (command === 'backups') {
    const { backups } = await request('/api/config/backups');
    backups.forEach((backup) => console.log(`${backup.createdAt}\t${backup.name}`));
    return;
  }
  if (command === 'restore') {
    if (!args[0]) throw new Error('Provide a backup filename.');
    const result = await request('/api/config/restore', { name: args[0] });
    console.log(`Restored ${result.projects} project(s).`);
    return;
  }

  const { projects } = await request('/api/projects');
  const project = findProject(projects, args.join(' '));
  if (!project) throw new Error(`No project matched "${args.join(' ')}".`);
  if (command === 'start') {
    const result = await request('/api/projects/start', { name: project.name });
    console.log(`Started ${project.name}: ${result.started.join(', ') || 'already live'}`);
    return;
  }
  if (command === 'stop') {
    const result = await request('/api/projects/stop', { name: project.name });
    console.log(`Stopped ${project.name}: ${result.stopped} action(s) completed.`);
    return;
  }
  if (command === 'open') {
    const url = project.components.flatMap((component) => component.detectedUrls || [])[0]
      || `http://localhost:${project.components.flatMap((component) => component.uiPorts || component.ports || [])[0]}/`;
    if (!url || url.includes('undefined')) throw new Error(`${project.name} has no detected UI URL.`);
    await request('/api/open-url', { url });
    console.log(`Opened ${url}`);
    return;
  }
  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`lair: ${error.message}`);
  process.exitCode = 1;
});
