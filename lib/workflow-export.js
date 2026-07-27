const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('./runtime-config');

function timestampName(now) {
  return now.toISOString().replace(/[:.]/g, '-');
}

function exportWorkflowBundle({
  exportsDirectory,
  skillsDirectory,
  instructionFiles = [],
  hooks = {},
  now = new Date(),
} = {}) {
  fs.mkdirSync(exportsDirectory, { recursive: true });
  const directory = path.join(exportsDirectory, timestampName(now));
  fs.mkdirSync(directory, { recursive: false });
  if (skillsDirectory && fs.existsSync(skillsDirectory)) {
    const resolvedSkillsDirectory = fs.realpathSync(skillsDirectory);
    fs.cpSync(resolvedSkillsDirectory, path.join(directory, 'skills'), {
      recursive: true,
      dereference: false,
      errorOnExist: true,
    });
  }
  const instructionsDirectory = path.join(directory, 'instructions');
  fs.mkdirSync(instructionsDirectory);
  const copiedInstructions = [];
  for (const file of instructionFiles) {
    if (!fs.existsSync(file)) continue;
    let name = path.basename(file);
    let collision = 0;
    while (fs.existsSync(path.join(instructionsDirectory, name))) {
      collision += 1;
      name = `${path.basename(file, path.extname(file))}-${collision}${path.extname(file)}`;
    }
    fs.copyFileSync(file, path.join(instructionsDirectory, name));
    copiedInstructions.push(name);
  }
  atomicWriteJson(path.join(directory, 'hooks.json'), hooks);
  atomicWriteJson(path.join(directory, 'manifest.json'), {
    version: 1,
    createdAt: now.toISOString(),
    skillsIncluded: Boolean(skillsDirectory && fs.existsSync(skillsDirectory)),
    instructionFiles: copiedInstructions,
    restore: 'Run Install-WorkspaceLinks.ps1 from your ai-workflow repository after copying files.',
  });
  return { directory, copiedInstructions };
}

module.exports = { exportWorkflowBundle, timestampName };
