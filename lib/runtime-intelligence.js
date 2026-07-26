const fs = require('fs');

const MAX_LOG_SCAN_BYTES = 128 * 1024;
const MAX_DETECTED_URLS = 6;

function extractLocalUrls(text) {
  return [...new Set([
    ...String(text || '').matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}(?:\/[^\s"'<>]*)?/gi),
  ].map((match) => match[0].replace(/[),.;]+$/, ''))
    .filter((url) => {
      try {
        const port = Number(new URL(url).port);
        return port > 0 && port <= 65535;
      } catch {
        return false;
      }
    }))].slice(-MAX_DETECTED_URLS);
}

function detectedUrlsFromLog(file) {
  if (!file) return [];
  let descriptor;
  try {
    const stat = fs.statSync(file);
    const readSize = Math.min(stat.size, MAX_LOG_SCAN_BYTES);
    descriptor = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(readSize);
    fs.readSync(descriptor, buffer, 0, readSize, Math.max(0, stat.size - readSize));
    return extractLocalUrls(buffer.toString('utf8'));
  } catch {
    return [];
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best-effort log scan */ }
    }
  }
}

function isZombieComponent({ running, uptimeSeconds, establishedConnections, thresholdHours }) {
  return running === true
    && Number.isFinite(uptimeSeconds)
    && uptimeSeconds >= thresholdHours * 3600
    && establishedConnections === 0;
}

module.exports = { detectedUrlsFromLog, extractLocalUrls, isZombieComponent };
