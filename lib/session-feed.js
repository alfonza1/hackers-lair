const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { redactValue } = require('./redaction');

const MAX_SESSIONS = 50;

function transcriptFiles(claudeHome) {
  const root = path.join(claudeHome, 'projects');
  const files = [];
  let projectDirectories;
  try { projectDirectories = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return []; }
  for (const project of projectDirectories) {
    if (!project.isDirectory()) continue;
    const directory = path.join(root, project.name);
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const file = path.join(directory, entry.name);
        files.push({ file, project: project.name, modifiedAt: fs.statSync(file).mtimeMs });
      }
    } catch {
      // Keep scanning other projects.
    }
  }
  return files.sort((left, right) => right.modifiedAt - left.modifiedAt).slice(0, MAX_SESSIONS);
}

function toolUseRecords(value) {
  const records = [];
  if (value?.tool_name) records.push({ name: value.tool_name, input: value.tool_input || {} });
  const content = value?.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'tool_use' && block.name) records.push({ name: block.name, input: block.input || {} });
    }
  }
  return records;
}

async function summarizeTranscript(record) {
  const stream = fs.createReadStream(record.file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const tools = new Set();
  const skills = new Set();
  let project = record.project;
  let startedAt = '';
  let endedAt = '';
  let malformedLines = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      const timestamp = value.timestamp || value.ts || '';
      if (Number.isFinite(Date.parse(timestamp))) {
        if (!startedAt || timestamp < startedAt) startedAt = timestamp;
        if (!endedAt || timestamp > endedAt) endedAt = timestamp;
      }
      project = value.cwd || value.project_dir || project;
      for (const tool of toolUseRecords(value)) {
        tools.add(String(tool.name));
        if (tool.name === 'Skill' && (tool.input.skill || tool.input.name)) {
          skills.add(String(tool.input.skill || tool.input.name));
        }
      }
    } catch {
      malformedLines += 1;
    }
  }
  return redactValue({
    id: path.basename(record.file, '.jsonl'),
    project,
    startedAt,
    endedAt,
    tools: [...tools].sort(),
    skills: [...skills].sort(),
    malformedLines,
  });
}

async function listSessions({ claudeHome, limit = MAX_SESSIONS } = {}) {
  const files = transcriptFiles(claudeHome).slice(0, Math.min(limit, MAX_SESSIONS));
  return Promise.all(files.map(summarizeTranscript));
}

module.exports = {
  MAX_SESSIONS,
  listSessions,
  summarizeTranscript,
  toolUseRecords,
  transcriptFiles,
};
