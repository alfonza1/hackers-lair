#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultDataDirectory({
  environment = process.env,
  platform = process.platform,
  homeDirectory = os.homedir(),
} = {}) {
  if (environment.PROJECT_MANAGER_DATA_DIR) return environment.PROJECT_MANAGER_DATA_DIR;
  if (platform === 'win32') {
    return path.join(environment.APPDATA || path.join(homeDirectory, 'AppData', 'Roaming'), 'HackersLair');
  }
  return path.join(environment.XDG_CONFIG_HOME || path.join(homeDirectory, '.config'), 'HackersLair');
}

const dataDirectory = defaultDataDirectory();
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
    const port = Number(identity.port);
    if (
      identity.app !== 'hackers-lair'
      || typeof identity.token !== 'string'
      || !identity.token
      || typeof identity.nonce !== 'string'
      || !identity.nonce
      || !Number.isInteger(port)
      || port < 1
      || port > 65535
    ) {
      throw new Error('invalid identity');
    }
    return { ...identity, port };
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
    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...(body === undefined ? {} : {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lair-Token': identity.token,
        },
        body: JSON.stringify(body),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }
  return { request };
}

function findProject(projects, query) {
  const normalized = String(query || '').toLowerCase();
  const exact = projects.find((project) => project.name.toLowerCase() === normalized);
  if (exact) return exact;
  const matches = projects.filter((project) => project.name.toLowerCase().includes(normalized));
  if (matches.length > 1) {
    throw new Error(`Project name is ambiguous: ${matches.map((project) => project.name).join(', ')}.`);
  }
  return matches[0];
}

function projectOpenUrl(project) {
  const components = Array.isArray(project?.components) ? project.components : [];
  const detectedUrl = components.flatMap((component) => component.detectedUrls || [])[0];
  if (detectedUrl) return detectedUrl;
  const configuredPort = components.flatMap((component) => [
    ...(component.uiPorts || []),
    ...(component.ports || []),
    component.port,
    ...(component.backendPorts || []),
  ]).map(Number).find((port) => Number.isInteger(port) && port > 0 && port <= 65535);
  return configuredPort ? `http://localhost:${configuredPort}/` : '';
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
  if (!['start', 'stop', 'open'].includes(command)) {
    usage();
    process.exitCode = 1;
    return;
  }

  const projectQuery = args.join(' ').trim();
  if (!projectQuery) throw new Error(`Provide a project name for "lair ${command}".`);
  const { projects } = await request('/api/projects');
  const project = findProject(projects, projectQuery);
  if (!project) throw new Error(`No project matched "${projectQuery}".`);
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
    const url = projectOpenUrl(project);
    if (!url) throw new Error(`${project.name} has no detected or configured UI URL.`);
    await request('/api/open-url', { url });
    console.log(`Opened ${url}`);
    return;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`lair: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { defaultDataDirectory, findProject, projectOpenUrl };
