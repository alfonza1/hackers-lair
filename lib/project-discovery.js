const fs = require('fs');
const path = require('path');

const MAX_SCAN_DIRECTORIES = 250;
const IS_WINDOWS = process.platform === 'win32';

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
        command: `${IS_WINDOWS ? 'npm.cmd' : 'npm'} run ${scriptName}`,
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
    const mavenWrapper = path.join(directory, IS_WINDOWS ? 'mvnw.cmd' : 'mvnw');
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
        command: fs.existsSync(mavenWrapper)
          ? `${path.basename(mavenWrapper)} spring-boot:run`
          : 'mvn spring-boot:run',
        match: directory,
      }],
    };
  }
  const gradleWrapper = path.join(directory, IS_WINDOWS ? 'gradlew.bat' : 'gradlew');
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
        command: fs.existsSync(gradleWrapper)
          ? `${path.basename(gradleWrapper)} bootRun`
          : 'gradle bootRun',
        match: directory,
      }],
    };
  }
  return null;
}

function pythonProposal(directory) {
  const candidates = ['main.py', 'app.py', 'manage.py']
    .filter((filename) => fs.existsSync(path.join(directory, filename)));
  const hasPythonMetadata = fs.existsSync(path.join(directory, 'pyproject.toml'))
    || fs.existsSync(path.join(directory, 'requirements.txt'));
  if (!candidates.length && !hasPythonMetadata) return null;
  const entry = candidates[0];
  if (!entry) return null;
  let source = '';
  try { source = fs.readFileSync(path.join(directory, entry), 'utf8').slice(0, 256 * 1024); }
  catch { /* use a generic Python process proposal */ }
  const python = IS_WINDOWS ? 'python' : 'python3';
  const isDjango = entry === 'manage.py';
  const isAsgi = /\b(FastAPI|uvicorn|Starlette)\b/.test(source);
  const isFlask = /\bFlask\b/.test(source);
  const ports = portsFromText(source);
  const port = ports[0] || (isDjango || isAsgi ? 8000 : isFlask ? 5000 : null);
  const moduleName = path.basename(entry, '.py');
  const command = isDjango
    ? `${python} manage.py runserver${port ? ` 127.0.0.1:${port}` : ''}`
    : isAsgi
      ? `${python} -m uvicorn ${moduleName}:app --reload${port ? ` --port ${port}` : ''}`
      : `${python} ${entry}`;
  return {
    name: path.basename(directory),
    type: isDjango ? 'django' : isAsgi ? 'fastapi' : isFlask ? 'flask' : 'python',
    discoveredFrom: path.join(directory, entry),
    confidence: isDjango || isAsgi || isFlask ? 'ready' : 'review',
    note: isDjango || isAsgi || isFlask
      ? `Detected ${isDjango ? 'Django' : isAsgi ? 'ASGI/FastAPI' : 'Flask'} entry point${port ? ` on port ${port}` : ''}.`
      : `Detected Python entry point ${entry}; confirm whether it starts a long-running service.`,
    components: [{
      name: isDjango || isAsgi || isFlask ? 'server' : 'process',
      role: isDjango || isAsgi || isFlask ? 'backend' : 'worker',
      cwd: directory,
      command,
      match: directory,
      ...(!port ? { track: 'process' } : { port }),
    }],
  };
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
      pythonProposal(directory),
    ].filter(Boolean);
    if (!candidates.length) continue;
    const preferred = candidates.find((candidate) => candidate.type === 'docker') || candidates[0];
    proposals.push(preferred);
  }
  return proposals;
}

module.exports = { discoverProjects, portsFromText };
