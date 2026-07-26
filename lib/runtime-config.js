const fs = require('fs');
const os = require('os');
const path = require('path');
const { assertSchema } = require('./schema-validator');

const MAX_CONFIG_BACKUPS = 10;

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
  constructor({ file, fallback, validate, backupDirectory }) {
    this.file = file;
    this.fallback = fallback;
    this.validate = validate;
    this.backupDirectory = backupDirectory;
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
    this.backup();
    atomicWriteJson(this.file, value);
    this.lastGood = value;
    this.lastError = null;
    return value;
  }

  backup() {
    if (!this.backupDirectory || !fs.existsSync(this.file)) return null;
    ensureDirectory(this.backupDirectory);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let backupFile = path.join(this.backupDirectory, `${timestamp}.json`);
    let collision = 0;
    while (fs.existsSync(backupFile)) {
      collision += 1;
      backupFile = path.join(this.backupDirectory, `${timestamp}-${collision}.json`);
    }
    fs.copyFileSync(this.file, backupFile);
    const backups = this.listBackups();
    for (const stale of backups.slice(MAX_CONFIG_BACKUPS)) {
      fs.unlinkSync(stale.path);
    }
    return backupFile;
  }

  listBackups() {
    if (!this.backupDirectory || !fs.existsSync(this.backupDirectory)) return [];
    return fs.readdirSync(this.backupDirectory)
      .filter((name) => /^\d{4}-\d{2}-\d{2}T[\d-]+Z(?:-\d+)?\.json$/.test(name))
      .map((name) => {
        const backupPath = path.join(this.backupDirectory, name);
        const stat = fs.statSync(backupPath);
        return { name, path: backupPath, createdAt: stat.mtime.toISOString(), size: stat.size };
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  restore(name) {
    const safeName = path.basename(String(name || ''));
    const backup = this.listBackups().find((item) => item.name === safeName);
    if (!backup) throw new Error('Configuration backup was not found.');
    const value = JSON.parse(fs.readFileSync(backup.path, 'utf8'));
    this.write(value);
    return value;
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
  if (value.workspaceFolders !== undefined && (
    !Array.isArray(value.workspaceFolders)
    || value.workspaceFolders.some((folder) => (
      typeof folder !== 'string'
      || !folder.trim()
      || !path.isAbsolute(folder)
    ))
  )) {
    throw new Error('workspaceFolders must be an array of absolute folder strings.');
  }
  if (value.zombieAfterHours !== undefined && (
    typeof value.zombieAfterHours !== 'number'
    || value.zombieAfterHours < 1
    || value.zombieAfterHours > 720
  )) {
    throw new Error('zombieAfterHours must be a number from 1 to 720.');
  }
}

function createRuntimeConfig(rootDirectory) {
  const dataDirectory = ensureDirectory(
    process.env.PROJECT_MANAGER_DATA_DIR || defaultDataDirectory(),
  );
  const projectsFile = process.env.PROJECTS_FILE || path.join(dataDirectory, 'projects.json');
  const scriptsFile = process.env.SCRIPTS_FILE || path.join(dataDirectory, 'scripts.json');
  const settingsFile = process.env.LAIR_SETTINGS_FILE || path.join(dataDirectory, 'settings.json');
  const schemaFile = path.join(dataDirectory, 'projects.schema.json');
  const bundledSchemaFile = path.join(rootDirectory, 'schemas', 'projects.schema.json');

  initializeUserFile({
    target: projectsFile,
    example: path.join(rootDirectory, 'projects.example.json'),
    legacy: path.join(rootDirectory, 'projects.json'),
  });
  if (!fs.existsSync(schemaFile)) fs.copyFileSync(bundledSchemaFile, schemaFile);
  else if (fs.readFileSync(schemaFile, 'utf8') !== fs.readFileSync(bundledSchemaFile, 'utf8')) {
    fs.copyFileSync(bundledSchemaFile, schemaFile);
  }
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

  const projectsSchema = JSON.parse(fs.readFileSync(bundledSchemaFile, 'utf8'));
  const backupRoot = ensureDirectory(path.join(dataDirectory, 'backups'));
  const runtime = {
    dataDirectory,
    identityFile: path.join(dataDirectory, 'api-token'),
    projectsSchema,
    projectsSchemaFile: schemaFile,
    projects: new JsonConfigStore({
      file: projectsFile,
      fallback: { $schema: './projects.schema.json', projects: [] },
      validate: (value) => assertSchema(value, projectsSchema),
      backupDirectory: path.join(backupRoot, 'projects'),
    }),
    scripts: new JsonConfigStore({
      file: scriptsFile,
      fallback: { scriptsDir: '', autoItExe: '', descriptions: {} },
      validate: validateScripts,
      backupDirectory: path.join(backupRoot, 'scripts'),
    }),
    settings: new JsonConfigStore({
      file: settingsFile,
      fallback: {
        enableSkills: false,
        browserPath: '',
        zombieAfterHours: 8,
        workspaceFolders: [],
      },
      validate: validateSettings,
      backupDirectory: path.join(backupRoot, 'settings'),
    }),
  };
  const projects = runtime.projects.read();
  if (!projects.error && !projects.value.$schema) {
    runtime.projects.write({ $schema: './projects.schema.json', ...projects.value });
  }
  return runtime;
}

module.exports = {
  JsonConfigStore,
  atomicWriteJson,
  createRuntimeConfig,
  defaultDataDirectory,
  formatConfigError,
  MAX_CONFIG_BACKUPS,
};
