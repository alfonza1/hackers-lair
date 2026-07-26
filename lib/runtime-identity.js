const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APP_ID = 'hackers-lair';

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function createRuntimeIdentity() {
  return Object.freeze({
    app: APP_ID,
    token: randomSecret(),
    nonce: randomSecret(),
    cspNonce: randomSecret(18),
  });
}

function writeRuntimeIdentity(file, identity, port) {
  const record = {
    app: identity.app,
    token: identity.token,
    nonce: identity.nonce,
    port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  const temporary = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
  return record;
}

function allowedHost(hostHeader, port) {
  const host = String(hostHeader || '').trim().toLowerCase();
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`;
}

function validToken(candidate, expected) {
  const provided = Buffer.from(String(candidate || ''), 'utf8');
  const actual = Buffer.from(expected, 'utf8');
  return provided.length === actual.length && crypto.timingSafeEqual(provided, actual);
}

function isJsonContentType(value) {
  return /^application\/json(?:\s*;|$)/i.test(String(value || ''));
}

function renderApplicationHtml(template, identity, port) {
  const bootstrap = JSON.stringify({
    token: identity.token,
    nonce: identity.nonce,
    port,
  }).replaceAll('<', '\\u003c');
  const bootstrapAssignment = `window.__LAIR_BOOTSTRAP__ = Object.freeze(${bootstrap});`;
  return template
    .replaceAll('__LAIR_CSP_NONCE__', identity.cspNonce)
    .replace('/*__LAIR_BOOTSTRAP_PAYLOAD__*/', bootstrapAssignment);
}

module.exports = {
  APP_ID,
  allowedHost,
  createRuntimeIdentity,
  isJsonContentType,
  renderApplicationHtml,
  validToken,
  writeRuntimeIdentity,
};
