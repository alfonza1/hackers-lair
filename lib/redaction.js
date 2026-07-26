const os = require('os');
const path = require('path');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactText(input) {
  let text = String(input ?? '');
  const home = os.homedir();
  const username = process.env.USERNAME || process.env.USER || path.basename(home);
  const replacements = [
    [home, '%USERPROFILE%'],
    [username, '<USER>'],
  ].filter(([value]) => value);
  for (const [value, replacement] of replacements) {
    text = text.replace(new RegExp(escapeRegExp(value), 'gi'), replacement);
  }
  text = text.replace(/\b[A-Z]:\\Users\\[^\\\s"']+/gi, '%USERPROFILE%');
  text = text.replace(/\b[A-Z]:\\(?:[^\\\r\n"']+\\){1,}([^\\\r\n"']+)/gi, '<PATH>\\$1');
  return text;
}

function redactValue(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactValue(child)]));
  }
  return value;
}

module.exports = { redactText, redactValue };
