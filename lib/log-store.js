const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_LOG_BYTES = 2 * 1024 * 1024;
const DEFAULT_RETAIN_LOG_BYTES = 1024 * 1024;
const ROTATION_MARKER = '\n--- older output truncated by Hacker\'s Lair ---\n';
const SERVICE_LOG_FILES = new Set([
  'backend-service.log',
  'runtime-errors.log',
]);

function logFiles(directory) {
  try {
    return fs.readdirSync(directory)
      .filter((name) => name.toLowerCase().endsWith('.log'))
      .map((name) => path.join(directory, name));
  } catch {
    return [];
  }
}

function safeSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

class LogStore {
  constructor(directory, {
    maxBytes = DEFAULT_MAX_LOG_BYTES,
    retainBytes = DEFAULT_RETAIN_LOG_BYTES,
  } = {}) {
    this.directory = directory;
    this.maxBytes = Math.max(64 * 1024, Number(maxBytes) || DEFAULT_MAX_LOG_BYTES);
    this.retainBytes = Math.min(
      Math.max(32 * 1024, Number(retainBytes) || DEFAULT_RETAIN_LOG_BYTES),
      this.maxBytes - Buffer.byteLength(ROTATION_MARKER),
    );
    fs.mkdirSync(directory, { recursive: true });
  }

  componentFile(projectName, componentName) {
    const slug = (value) => String(value).replace(/[^a-z0-9._-]+/gi, '_');
    return path.join(this.directory, `${slug(projectName)}--${slug(componentName)}.log`);
  }

  prepare(file, { append = false, heading = '' } = {}) {
    fs.mkdirSync(this.directory, { recursive: true });
    if (!append) fs.writeFileSync(file, '', 'utf8');
    if (heading) fs.appendFileSync(file, heading, 'utf8');
    this.trim(file);
    return file;
  }

  openAppendDescriptors(file) {
    return [fs.openSync(file, 'a'), fs.openSync(file, 'a')];
  }

  trim(file) {
    const size = safeSize(file);
    if (size <= this.maxBytes) return false;
    const keep = Math.min(this.retainBytes, size);
    const source = fs.openSync(file, 'r');
    let tail;
    try {
      tail = Buffer.alloc(keep);
      fs.readSync(source, tail, 0, keep, size - keep);
    } finally {
      fs.closeSync(source);
    }
    const target = fs.openSync(file, 'r+');
    try {
      fs.ftruncateSync(target, 0);
      const rotated = Buffer.concat([Buffer.from(ROTATION_MARKER, 'utf8'), tail]);
      fs.writeSync(target, rotated, 0, rotated.length, 0);
    } finally {
      fs.closeSync(target);
    }
    return true;
  }

  maintain(validComponentFiles = null) {
    const valid = validComponentFiles
      ? new Set([...validComponentFiles].map((file) => path.resolve(file).toLowerCase()))
      : null;
    let rotated = 0;
    let pruned = 0;
    for (const file of logFiles(this.directory)) {
      const isRuntimeLog = SERVICE_LOG_FILES.has(path.basename(file).toLowerCase());
      if (valid && !isRuntimeLog && !valid.has(path.resolve(file).toLowerCase())) {
        try {
          fs.unlinkSync(file);
          pruned += 1;
        } catch {
          // A live process may still own the file on Windows; retry next cycle.
        }
        continue;
      }
      try {
        if (this.trim(file)) rotated += 1;
      } catch {
        // Log maintenance must never take down the control service.
      }
    }
    return { rotated, pruned };
  }

  summary() {
    const files = logFiles(this.directory);
    return {
      directory: this.directory,
      files: files.length,
      bytes: files.reduce((total, file) => total + safeSize(file), 0),
      perComponentLimitBytes: this.maxBytes,
    };
  }

  clear() {
    let cleared = 0;
    for (const file of logFiles(this.directory)) {
      try {
        fs.truncateSync(file, 0);
        cleared += 1;
      } catch {
        // Report the files actually cleared; callers can retry locked files.
      }
    }
    return { ...this.summary(), cleared };
  }

  appendRuntimeError(kind, error, context = {}) {
    const normalized = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: typeof error, message: String(error), stack: '' };
    return this.appendRuntimeEvent(kind, {
      ...context,
      error: normalized,
    });
  }

  appendRuntimeEvent(kind, context = {}) {
    const file = path.join(this.directory, 'runtime-errors.log');
    const entry = {
      at: new Date().toISOString(),
      kind,
      pid: process.pid,
      ...context,
    };
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
    this.trim(file);
    return file;
  }
}

module.exports = {
  DEFAULT_MAX_LOG_BYTES,
  LogStore,
  ROTATION_MARKER,
};
