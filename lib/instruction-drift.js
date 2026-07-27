const fs = require('fs');
const path = require('path');

function looksLikePath(value) {
  return /^(?:\.{1,2}[\\/]|[a-z]:[\\/]|\/|(?:scripts|docs|references|assets|src|lib|tests?)[\\/])/i.test(value);
}

function instructionReferences(source) {
  const references = [];
  const seen = new Set();
  const add = (type, value) => {
    const normalized = String(value || '').trim().replace(/^<|>$/g, '').split(/[?#]/)[0];
    const key = `${type}:${normalized}`;
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    references.push({ type, value: normalized });
  };
  for (const match of String(source || '').matchAll(/`([^`\r\n]+)`/g)) {
    const value = match[1].trim();
    if (looksLikePath(value)) add('path', value);
    else add('command', value.split(/\s+/)[0]);
  }
  for (const match of String(source || '').matchAll(/\]\(([^)]+)\)/g)) {
    const value = match[1].trim();
    if (!/^(?:[a-z]+:|#)/i.test(value)) add('path', value);
  }
  return references;
}

async function checkInstructionDrift(file, {
  commandExists = async () => true,
} = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const findings = [];
  for (const reference of instructionReferences(source)) {
    if (reference.type === 'command') {
      if (!(await commandExists(reference.value))) {
        findings.push({
          code: 'missing-command',
          level: 'warn',
          message: `Command is not available on PATH: ${reference.value}`,
          reference: reference.value,
        });
      }
      continue;
    }
    const target = path.isAbsolute(reference.value)
      ? reference.value
      : path.resolve(path.dirname(file), reference.value);
    if (!fs.existsSync(target)) {
      findings.push({
        code: 'missing-path',
        level: 'warn',
        message: `Referenced path does not exist: ${reference.value}`,
        reference: reference.value,
      });
    }
  }
  return { checkedAt: new Date().toISOString(), findings };
}

module.exports = {
  checkInstructionDrift,
  instructionReferences,
  looksLikePath,
};
