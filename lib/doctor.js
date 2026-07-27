const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const { redactText } = require('./redaction');
const { createPlatform } = require('./platform');
const { componentPorts } = require('./project-config');

const platform = createPlatform();

function check(level, id, label, detail) {
  return { level, id, label, detail };
}

function workflowLinkHealth({
  agentsHome,
  claudeHome,
  instructionFiles = [],
} = {}) {
  const checks = [];
  const agentsSkills = path.join(agentsHome || '', 'skills');
  const claudeSkills = path.join(claudeHome || '', 'skills');
  try {
    const agentsReal = fs.realpathSync(agentsSkills);
    const claudeReal = fs.realpathSync(claudeSkills);
    checks.push(check(
      agentsReal === claudeReal ? 'pass' : 'warn',
      'workflow-skill-links',
      agentsReal === claudeReal ? 'Agent skill links share one source' : 'Agent skill links point to different sources',
      `${agentsSkills} -> ${agentsReal}; ${claudeSkills} -> ${claudeReal}`,
    ));
  } catch (error) {
    checks.push(check(
      'warn',
      'workflow-skill-links',
      'Agent skill link parity is incomplete',
      error.message,
    ));
  }

  const existing = [...new Set(instructionFiles.map((file) => path.resolve(file)))]
    .filter((file) => fs.existsSync(file));
  if (existing.length < 2) {
    checks.push(check(
      'pass',
      'workflow-instruction-links',
      'No linked instruction pair requires verification',
      existing.length ? existing[0] : 'No workspace instruction files were found.',
    ));
    return checks;
  }
  const baseline = fs.statSync(existing[0]);
  const baselineHash = crypto.createHash('sha256').update(fs.readFileSync(existing[0])).digest('hex');
  const same = existing.slice(1).every((file) => {
    const stat = fs.statSync(file);
    if (baseline.ino && stat.ino && baseline.ino === stat.ino) return true;
    if (baseline.size !== stat.size) return false;
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === baselineHash;
  });
  checks.push(check(
    same ? 'pass' : 'warn',
    'workflow-instruction-links',
    same ? 'Linked workspace instructions match' : 'Workspace instruction links have drifted',
    existing.join('; '),
  ));
  return checks;
}

async function runDoctor({
  dataDirectory,
  projects,
  configErrors = [],
  installChannel = 'source',
  port = null,
  agentsHome = '',
  claudeHome = '',
  instructionFiles = [],
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

  const tools = await Promise.all(['node', 'git', 'docker', 'code'].map(async (tool) => {
    const exists = await platform.executableExists(tool);
    return {
      tool,
      exists,
      version: exists ? await platform.toolVersion(tool) : 'not found',
    };
  }));
  for (const tool of tools) {
    checks.push(check(
      tool.exists ? 'pass' : 'warn',
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
      for (const value of componentPorts(component)) {
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

  checks.push(...workflowLinkHealth({ agentsHome, claudeHome, instructionFiles }));

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

module.exports = { formatDoctorReport, runDoctor, workflowLinkHealth };
