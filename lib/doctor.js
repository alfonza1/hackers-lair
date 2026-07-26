const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const { redactText } = require('./redaction');

const execFileAsync = promisify(execFile);

async function executableExists(name) {
  try {
    await execFileAsync('where.exe', [name], { windowsHide: true, timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

async function toolVersion(command, args = ['--version']) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      windowsHide: true,
      timeout: 3_000,
      maxBuffer: 1024 * 1024,
    });
    return String(stdout || stderr).trim().split(/\r?\n/)[0] || 'available';
  } catch {
    return 'not found';
  }
}

function check(level, id, label, detail) {
  return { level, id, label, detail };
}

async function runDoctor({
  dataDirectory,
  projects,
  configErrors = [],
  installChannel = 'source',
  port = null,
}) {
  const checks = [];
  const probe = path.join(dataDirectory, `.doctor-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(probe, 'ok', { encoding: 'utf8', mode: 0o600 });
    fs.unlinkSync(probe);
    checks.push(check('pass', 'data-writable', 'Data directory writable', dataDirectory));
  } catch (error) {
    checks.push(check('fail', 'data-writable', 'Data directory is not writable', error.message));
  }

  const tools = await Promise.all(['node', 'git', 'docker', 'code'].map(async (tool) => ({
    tool,
    exists: tool === 'node' || await executableExists(tool),
    version: tool === 'node' ? process.version : await toolVersion(tool),
  })));
  for (const tool of tools) {
    checks.push(check(
      tool.exists ? 'pass' : ['docker', 'code'].includes(tool.tool) ? 'warn' : 'fail',
      `tool-${tool.tool}`,
      `${tool.tool} ${tool.exists ? 'available' : 'not found'}`,
      tool.exists ? tool.version : 'Install it or add it to PATH if your projects require it.',
    ));
  }

  const missingFolders = [];
  const portOwners = new Map();
  for (const project of projects || []) {
    for (const component of project.components || []) {
      if (component.cwd && !fs.existsSync(component.cwd)) {
        missingFolders.push(`${project.name} / ${component.name}: ${component.cwd}`);
      }
      const ports = Array.isArray(component.ports) ? component.ports : [component.port];
      for (const value of ports) {
        const port = Number(value);
        if (!Number.isInteger(port)) continue;
        const owners = portOwners.get(port) || [];
        owners.push(`${project.name} / ${component.name}`);
        portOwners.set(port, owners);
      }
    }
  }
  checks.push(check(
    missingFolders.length ? 'fail' : 'pass',
    'project-folders',
    missingFolders.length ? `${missingFolders.length} configured folder(s) missing` : 'Configured folders exist',
    missingFolders.join('; ') || 'All configured component paths were found.',
  ));

  const duplicatePorts = [...portOwners.entries()].filter(([, owners]) => owners.length > 1);
  checks.push(check(
    duplicatePorts.length ? 'warn' : 'pass',
    'duplicate-ports',
    duplicatePorts.length ? `${duplicatePorts.length} duplicate configured port(s)` : 'No duplicate configured ports',
    duplicatePorts.map(([port, owners]) => `${port}: ${owners.join(', ')}`).join('; ') || 'Configured ports are unique.',
  ));

  for (const error of configErrors.filter(Boolean)) {
    checks.push(check('fail', 'config-parse', 'Configuration parse error', error));
  }

  const failures = checks.filter((item) => item.level === 'fail').length;
  const warnings = checks.filter((item) => item.level === 'warn').length;
  const report = {
    status: failures ? 'fail' : warnings ? 'warn' : 'pass',
    failures,
    warnings,
    checkedAt: new Date().toISOString(),
    checks,
    environment: {
      appVersion: require('../package.json').version,
      installChannel,
      node: process.version,
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      port,
      dataDirectory,
    },
  };
  return report;
}

function formatDoctorReport(report) {
  const lines = [
    "# Hacker's Lair diagnostic report",
    '',
    `Generated: ${report.checkedAt}`,
    `Status: ${report.status} (${report.failures} failures, ${report.warnings} warnings)`,
    `App: ${report.environment.appVersion} via ${report.environment.installChannel}`,
    `Runtime: ${report.environment.node}`,
    `OS: ${report.environment.os}`,
    `Local port: ${report.environment.port || 'unknown'}`,
    `Data directory: ${report.environment.dataDirectory}`,
    '',
    '## Checks',
    ...report.checks.map((item) => `- [${item.level.toUpperCase()}] ${item.label}: ${item.detail}`),
  ];
  return redactText(lines.join('\n'));
}

module.exports = { formatDoctorReport, runDoctor };
