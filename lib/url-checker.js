const fs = require('fs');
const { atomicWriteJson } = require('./runtime-config');

const URL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const URL_TIMEOUT_MS = 5_000;

function extractHttpUrls(source) {
  const matches = String(source || '').match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  return [...new Set(matches.map((value) => value.replace(/[),.;:\]]+$/g, '')).filter((value) => {
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }))];
}

function readCache(cacheFile) {
  try {
    const value = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

async function requestHead(url, {
  fetchImpl,
  timeoutMs,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status, error: '' };
  } catch (error) {
    return { ok: false, status: 0, error: error.name === 'AbortError' ? 'Timed out' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function checkFileUrls(file, {
  cacheFile,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  timeoutMs = URL_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('URL checking is unavailable in this runtime.');
  const urls = extractHttpUrls(fs.readFileSync(file, 'utf8'));
  const cache = readCache(cacheFile);
  const nowMs = now.getTime();
  const results = [];
  for (const url of urls) {
    const cached = cache[url];
    if (cached && nowMs - Date.parse(cached.checkedAt) < URL_CACHE_TTL_MS) {
      results.push({ ...cached, url, cached: true });
      continue;
    }
    const checked = await requestHead(url, { fetchImpl, timeoutMs });
    const result = { url, ...checked, checkedAt: now.toISOString() };
    cache[url] = result;
    results.push({ ...result, cached: false });
  }
  atomicWriteJson(cacheFile, cache);
  return { file, checkedAt: now.toISOString(), results };
}

module.exports = {
  URL_CACHE_TTL_MS,
  URL_TIMEOUT_MS,
  checkFileUrls,
  extractHttpUrls,
  requestHead,
};
