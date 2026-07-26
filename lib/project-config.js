const fs = require('fs');
const path = require('path');

function componentPorts(component) {
  return [...new Set([
    component.port,
    ...(component.ports || []),
    ...(component.uiPorts || []),
    ...(component.backendPorts || []),
  ].map(Number).filter((port) => Number.isInteger(port)))];
}

function cleanComponent(component) {
  const rawPorts = [
    component?.port,
    ...(Array.isArray(component?.ports) ? component.ports : []),
    ...(Array.isArray(component?.uiPorts) ? component.uiPorts : []),
    ...(Array.isArray(component?.backendPorts) ? component.backendPorts : []),
  ].filter((value) => value !== undefined && value !== null && value !== '');
  if (rawPorts.some((value) => (
    !Number.isInteger(Number(value))
    || Number(value) < 1
    || Number(value) > 65535
  ))) {
    throw new Error(`${String(component?.name || 'Component')}: ports must be whole numbers from 1 to 65535.`);
  }
  const cleaned = {
    name: String(component?.name || '').trim(),
    role: String(component?.role || '').trim(),
    cwd: String(component?.cwd || '').trim(),
    command: String(component?.command || '').trim(),
    stopCommand: String(component?.stopCommand || '').trim(),
    match: String(component?.match || '').trim(),
  };
  const ports = [...new Set([
    component?.port,
    ...(Array.isArray(component?.ports) ? component.ports : []),
  ].map(Number).filter((port) => Number.isInteger(port)))];
  const uiPorts = [...new Set((component?.uiPorts || [])
    .map(Number)
    .filter((port) => Number.isInteger(port)))];
  const backendPorts = [...new Set((component?.backendPorts || [])
    .map(Number)
    .filter((port) => Number.isInteger(port)))];
  if (ports.length === 1) cleaned.port = ports[0];
  if (ports.length > 1) cleaned.ports = ports;
  if (uiPorts.length) cleaned.uiPorts = uiPorts;
  if (backendPorts.length) cleaned.backendPorts = backendPorts;
  if (component?.track === 'process') cleaned.track = 'process';
  if (component?.detectByPort === true) cleaned.detectByPort = true;
  if (component?.autoRestart === true) cleaned.autoRestart = true;
  if (Number.isInteger(Number(component?.maxRestarts))) {
    cleaned.maxRestarts = Number(component.maxRestarts);
  }
  if (
    Number.isFinite(Number(component?.zombieAfterHours))
    && Number(component.zombieAfterHours) >= 1
    && Number(component.zombieAfterHours) <= 720
  ) {
    cleaned.zombieAfterHours = Number(component.zombieAfterHours);
  }
  return Object.fromEntries(Object.entries(cleaned).filter(([, value]) => value !== ''));
}

function normalizeProject(project) {
  return {
    name: String(project?.name || '').trim(),
    ...(String(project?.type || '').trim() ? { type: String(project.type).trim() } : {}),
    components: Array.isArray(project?.components)
      ? project.components.map(cleanComponent)
      : [],
  };
}

function validateProject(project, { exists = fs.existsSync } = {}) {
  if (!project.name) throw new Error('Project name is required.');
  if (project.name.length > 80) throw new Error('Project name must be 80 characters or fewer.');
  if (!project.components.length) throw new Error('Add at least one component.');

  const names = new Set();
  for (const component of project.components) {
    if (!component.name) throw new Error('Every component needs a name.');
    const nameKey = component.name.toLowerCase();
    if (names.has(nameKey)) throw new Error(`Component name "${component.name}" is duplicated.`);
    names.add(nameKey);
    if (!component.cwd || !path.isAbsolute(component.cwd)) {
      throw new Error(`${component.name}: folder must be an absolute path.`);
    }
    if (!exists(component.cwd)) throw new Error(`${component.name}: folder does not exist.`);
    if (!component.command) throw new Error(`${component.name}: command is required.`);
    for (const port of componentPorts(component)) {
      if (port < 1 || port > 65535) {
        throw new Error(`${component.name}: port ${port} must be from 1 to 65535.`);
      }
    }
  }
}

function updateProjectConfig(config, { originalName = '', project }, options = {}) {
  const normalized = normalizeProject(project);
  validateProject(normalized, options);
  const originalKey = String(originalName || '').trim().toLowerCase();
  const projectKey = normalized.name.toLowerCase();
  const currentProjects = Array.isArray(config?.projects) ? config.projects : [];
  const editingIndex = originalKey
    ? currentProjects.findIndex((item) => String(item.name).toLowerCase() === originalKey)
    : -1;
  if (originalKey && editingIndex < 0) throw new Error('The project being edited no longer exists.');
  if (currentProjects.some((item, index) => (
    index !== editingIndex && String(item.name).toLowerCase() === projectKey
  ))) {
    throw new Error(`A project named "${normalized.name}" already exists.`);
  }

  const nextProjects = currentProjects.slice();
  if (editingIndex >= 0) nextProjects[editingIndex] = normalized;
  else nextProjects.push(normalized);

  const ownerByPort = new Map();
  for (const candidate of nextProjects) {
    for (const component of candidate.components || []) {
      for (const port of componentPorts(component)) {
        const owner = `${candidate.name} / ${component.name}`;
        if (ownerByPort.has(port) && ownerByPort.get(port) !== owner) {
          throw new Error(`Port ${port} is already configured by ${ownerByPort.get(port)}.`);
        }
        ownerByPort.set(port, owner);
      }
    }
  }

  return {
    ...config,
    $schema: './projects.schema.json',
    projects: nextProjects,
  };
}

function removeProjectFromConfig(config, name) {
  const key = String(name || '').trim().toLowerCase();
  const projects = (config.projects || []).filter((project) => (
    String(project.name).toLowerCase() !== key
  ));
  if (projects.length === (config.projects || []).length) {
    throw new Error('Project was not found.');
  }
  return { ...config, projects };
}

module.exports = {
  componentPorts,
  normalizeProject,
  removeProjectFromConfig,
  updateProjectConfig,
  validateProject,
};
