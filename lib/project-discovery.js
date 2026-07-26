const fs = require('fs');
const path = require('path');

const MAX_SCAN_DIRECTORIES = 250;

function distinctPorts(values) {
  return [...new Set(values
    .map(Number)
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))];
}

function portsFromText(text) {
  const ports = [];
  for (const match of String(text || '').matchAll(/(?:--port(?:=|\s+)|localhost:|127\.0\.0\.1:)(\d{2,5})/gi)) {
    ports.push(Number(match[1]));
  }
  return distinctPorts(ports);
}

function composePorts(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const ports = [];
    for (const match of text.matchAll(/^\s*-\s*["']?(\d{2,5})\s*:\s*\d{2,5}/gm)) {
      ports.push(Number(match[1]));
    }
    return distinctPorts(ports);
  } catch {
    return [];
  }
}

function packageProposal(directory) {
  const packageFile = path.join(directory, 'package.json');
  if (!fs.existsSync(packageFile)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const scripts = pkg.scripts || {};
    const scriptName = scripts.dev ? 'dev' : scripts.start ? 'start' : '';
    if (!scriptName) return null;
    const commandText = String(scripts[scriptName]);
    const ports = portsFromText(commandText);
    return {
      name: String(pkg.name || path.basename(directory)),
      type: 'node',
      discoveredFrom: packageFile,
      confidence: ports.length ? 'ready' : 'review',
      note: ports.length
        ? `Detected npm ${scriptName} and port ${ports.join(', ')}.`
        : `Detected npm ${scriptName}; confirm its listening port after import.`,
      components: [{
        name: scriptName,
        role: scriptName === 'dev' ? 'frontend' : 'service',
        cwd: directory,
        command: `npm.cmd run ${scriptName}`,
        match: directory,
        ...(ports.length === 1 ? { port: ports[0] } : {}),
        ...(ports.length > 1 ? { ports, detectByPort: true } : {}),
      }],
    };
  } catch {
    return null;
  }
}

function composeProposal(directory) {
  const filename = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
    .find((candidate) => fs.existsSync(path.join(directory, candidate)));
  if (!filename) return null;
  const composeFile = path.join(directory, filename);
  const ports = composePorts(composeFile);
  return {
    name: path.basename(directory),
    type: 'docker',
    discoveredFrom: composeFile,
    confidence: ports.length ? 'ready' : 'review',
    note: ports.length
      ? `Detected Docker Compose with host ports ${ports.join(', ')}.`
      : 'Detected Docker Compose; add exposed host ports for reliable status detection.',
    components: [{
      name: 'stack',
      role: 'fullstack',
      cwd: directory,
      command: 'docker compose up -d',
      stopCommand: 'docker compose down',
      match: directory,
      track: 'process',
      ...(ports.length ? { ports, detectByPort: true } : {}),
    }],
  };
}

function buildToolProposal(directory) {
  if (fs.existsSync(path.join(directory, 'pom.xml'))) {
    return {
      name: path.basename(directory),
      type: 'java',
      discoveredFrom: path.join(directory, 'pom.xml'),
      confidence: 'review',
      note: 'Detected Maven; confirm the application port after import.',
      components: [{
        name: 'server',
        role: 'backend',
        cwd: directory,
        command: fs.existsSync(path.join(directory, 'mvnw.cmd')) ? 'mvnw.cmd spring-boot:run' : 'mvn spring-boot:run',
        match: directory,
      }],
    };
  }
  const gradleWrapper = path.join(directory, 'gradlew.bat');
  if (fs.existsSync(gradleWrapper) || fs.existsSync(path.join(directory, 'build.gradle'))) {
    return {
      name: path.basename(directory),
      type: 'java',
      discoveredFrom: fs.existsSync(gradleWrapper) ? gradleWrapper : path.join(directory, 'build.gradle'),
      confidence: 'review',
      note: 'Detected Gradle; confirm the run task and application port after import.',
      components: [{
        name: 'server',
        role: 'backend',
        cwd: directory,
        command: fs.existsSync(gradleWrapper) ? 'gradlew.bat bootRun' : 'gradle bootRun',
        match: directory,
      }],
    };
  }
  return null;
}

function discoverProjects(rootDirectory) {
  const root = path.resolve(String(rootDirectory || ''));
  if (!path.isAbsolute(root) || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error('Scan folder must be an existing absolute directory.');
  }

  const children = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .slice(0, MAX_SCAN_DIRECTORIES)
    .map((entry) => path.join(root, entry.name));
  const directories = [root, ...children];
  const proposals = [];

  for (const directory of directories) {
    const candidates = [
      composeProposal(directory),
      packageProposal(directory),
      buildToolProposal(directory),
    ].filter(Boolean);
    if (!candidates.length) continue;
    const preferred = candidates.find((candidate) => candidate.type === 'docker') || candidates[0];
    proposals.push(preferred);
  }
  return proposals;
}

module.exports = { discoverProjects, portsFromText };
