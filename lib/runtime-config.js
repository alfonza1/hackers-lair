const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultDataDirectory() {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'HackersLair');
  return path.join(os.homedir(), 'AppData', 'Roaming', 'HackersLair');
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function initializeUserFile({ target, example, legacy }) {
  if (fs.existsSync(target)) return;
  const source = legacy && fs.existsSync(legacy) ? legacy : example;
  if (!source || !fs.existsSync(source)) {
    throw new Error(`Cannot initialize ${target}: no example file exists.`);
  }
  ensureDirectory(path.dirname(target));
  try {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

function atomicWriteJson(file, value) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
}

function formatConfigError(file, error, source = '') {
  const message = String(error.message || error);
  if (/\bposition \d+/i.test(message)) return `${file}: ${message}`;
  let position = source.length;
  const unexpectedToken = message.match(/Unexpected token '([^']+)'/i);
  if (unexpectedToken) {
    const foundAt = source.indexOf(unexpectedToken[1]);
    if (foundAt >= 0) position = foundAt;
  }
  return `${file}: ${message} (position ${position})`;
}

class JsonConfigStore {
  constructor({ file, fallback, validate }) {
    this.file = file;
    this.fallback = fallback;
    this.validate = validate;
    this.lastGood = null;
    this.lastError = null;
  }

  read() {
    try {
      const source = fs.readFileSync(this.file, 'utf8');
      const value = JSON.parse(source);
      this.validate(value);
      this.lastGood = value;
      this.lastError = null;
    } catch (error) {
      let source = '';
      try { source = fs.readFileSync(this.file, 'utf8'); } catch { /* original error is clearer */ }
      this.lastError = formatConfigError(this.file, error, source);
    }
    return {
      value: this.lastGood ?? this.fallback,
      error: this.lastError,
      file: this.file,
    };
  }

  write(value) {
    this.validate(value);
    atomicWriteJson(this.file, value);
    this.lastGood = value;
    this.lastError = null;
    return value;
  }
}

function validateProjects(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.projects)) {
    throw new Error('Expected an object containing a projects array.');
  }
}

function validateScripts(value) {
  if (!value || typeof value !== 'object') throw new Error('Expected a scripts configuration object.');
  for (const field of ['scriptsDir', 'autoItExe']) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      throw new Error(`${field} must be a string.`);
    }
  }
  if (value.descriptions !== undefined && (
    !value.descriptions
    || typeof value.descriptions !== 'object'
    || Array.isArray(value.descriptions)
  )) {
    throw new Error('descriptions must be an object.');
  }
}

function validateSettings(value) {
  if (!value || typeof value !== 'object') throw new Error('Expected a settings object.');
  if (value.enableSkills !== undefined && typeof value.enableSkills !== 'boolean') {
    throw new Error('enableSkills must be true or false.');
  }
  if (value.browserPath !== undefined && typeof value.browserPath !== 'string') {
    throw new Error('browserPath must be a string.');
  }
}

function createRuntimeConfig(rootDirectory) {
  const dataDirectory = ensureDirectory(
    process.env.PROJECT_MANAGER_DATA_DIR || defaultDataDirectory(),
  );
  const projectsFile = process.env.PROJECTS_FILE || path.join(dataDirectory, 'projects.json');
  const scriptsFile = process.env.SCRIPTS_FILE || path.join(dataDirectory, 'scripts.json');
  const settingsFile = process.env.LAIR_SETTINGS_FILE || path.join(dataDirectory, 'settings.json');

  initializeUserFile({
    target: projectsFile,
    example: path.join(rootDirectory, 'projects.example.json'),
    legacy: path.join(rootDirectory, 'projects.json'),
  });
  initializeUserFile({
    target: scriptsFile,
    example: path.join(rootDirectory, 'scripts.example.json'),
    legacy: path.join(rootDirectory, 'scripts.json'),
  });
  initializeUserFile({
    target: settingsFile,
    example: path.join(rootDirectory, 'settings.example.json'),
    legacy: path.join(rootDirectory, 'settings.json'),
  });

  return {
    dataDirectory,
    identityFile: path.join(dataDirectory, 'api-token'),
    projects: new JsonConfigStore({
      file: projectsFile,
      fallback: { projects: [] },
      validate: validateProjects,
    }),
    scripts: new JsonConfigStore({
      file: scriptsFile,
      fallback: { scriptsDir: '', autoItExe: '', descriptions: {} },
      validate: validateScripts,
    }),
    settings: new JsonConfigStore({
      file: settingsFile,
      fallback: { enableSkills: false, browserPath: '' },
      validate: validateSettings,
    }),
  };
}

module.exports = {
  JsonConfigStore,
  atomicWriteJson,
  createRuntimeConfig,
  defaultDataDirectory,
  formatConfigError,
};
