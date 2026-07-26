const { componentPorts } = require('./project-config');

function projectPorts(project) {
  return new Set((project?.components || []).flatMap(componentPorts));
}

function listenerName(listener) {
  return String(listener.label || listener.name || '').trim() || 'unknown application';
}

function findProjectPortConflicts({ project, originalProject, listeners = [] }) {
  const existingPorts = projectPorts(originalProject);
  const portsToCheck = projectPorts(project);
  for (const port of existingPorts) portsToCheck.delete(port);

  const conflicts = [];
  const seen = new Set();
  for (const listener of listeners) {
    for (const binding of listener.ports || []) {
      const port = Number(binding.port);
      if (!portsToCheck.has(port)) continue;
      const key = `${port}:${listener.pid ?? 'unknown'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({
        port,
        pid: Number.isInteger(Number(listener.pid)) ? Number(listener.pid) : null,
        name: listenerName(listener),
        protected: listener.protected === true,
      });
    }
  }
  return conflicts.sort((left, right) => (
    left.port - right.port || (left.pid || 0) - (right.pid || 0)
  ));
}

function describeProjectPortConflicts(conflicts) {
  const owners = conflicts.map((conflict) => {
    const pid = conflict.pid === null ? '' : ` (PID ${conflict.pid})`;
    return `port ${conflict.port} by ${conflict.name}${pid}`;
  });
  const prefix = conflicts.length === 1
    ? 'A configured port is already in use'
    : 'Configured ports are already in use';
  const resolution = conflicts.length === 1
    ? 'Stop that application or choose a different port.'
    : 'Stop those applications or choose different ports.';
  return `${prefix}: ${owners.join('; ')}. ${resolution}`;
}

module.exports = {
  describeProjectPortConflicts,
  findProjectPortConflicts,
  projectPorts,
};
