const path = require('path');

const PROJECT_TEMPLATES = Object.freeze([
  {
    id: 'vite',
    name: 'Vite',
    type: 'Vite',
    defaultPort: 5173,
    component: { name: 'frontend', role: 'frontend', command: 'npm.cmd run dev -- --port {port}' },
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    type: 'Next.js',
    defaultPort: 3000,
    component: { name: 'web', role: 'fullstack', command: 'npm.cmd run dev -- --port {port}' },
  },
  {
    id: 'spring-boot',
    name: 'Spring Boot',
    type: 'Spring Boot',
    defaultPort: 8080,
    component: { name: 'server', role: 'backend', command: 'mvnw.cmd spring-boot:run' },
  },
  {
    id: 'fastapi',
    name: 'FastAPI',
    type: 'FastAPI',
    defaultPort: 8000,
    component: { name: 'api', role: 'backend', command: 'python -m uvicorn main:app --reload --port {port}' },
  },
  {
    id: 'compose',
    name: 'Docker Compose',
    type: 'Docker Compose',
    defaultPort: 3000,
    component: {
      name: 'stack',
      role: 'fullstack',
      command: 'docker compose up -d',
      stopCommand: 'docker compose down',
      track: 'process',
    },
  },
]);

function instantiateTemplate({ templateId, name, folder, port }) {
  const template = PROJECT_TEMPLATES.find((item) => item.id === templateId);
  if (!template) throw new Error('Unknown project template.');
  const projectName = String(name || '').trim();
  const folderInput = String(folder || '').trim();
  const selectedPort = Number(port || template.defaultPort);
  if (!projectName) throw new Error('Project name is required.');
  if (!folderInput) throw new Error('Project folder is required.');
  const cwd = path.resolve(folderInput);
  if (!path.isAbsolute(cwd)) throw new Error('Project folder must be absolute.');
  if (!Number.isInteger(selectedPort) || selectedPort < 1 || selectedPort > 65535) {
    throw new Error('Port must be an integer from 1 to 65535.');
  }
  const component = {
    ...template.component,
    cwd,
    command: template.component.command.replaceAll('{port}', String(selectedPort)),
    match: cwd,
    port: selectedPort,
    ...(template.id === 'compose' ? { ports: [selectedPort], detectByPort: true } : {}),
  };
  return { name: projectName, type: template.type, components: [component] };
}

module.exports = { instantiateTemplate, PROJECT_TEMPLATES };
