const fs = require('fs');
const path = require('path');

function readPermissions(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const permissions = value?.permissions;
    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return null;
    return permissions;
  } catch {
    return null;
  }
}

function permissionsView({
  claudeHome,
  projectFolders = [],
} = {}) {
  const sources = [
    { file: path.join(path.resolve(claudeHome || ''), 'settings.json'), scope: 'user', project: '' },
    ...projectFolders.flatMap((projectFolder) => {
      const directory = path.join(path.resolve(projectFolder), '.claude');
      const project = path.basename(path.resolve(projectFolder));
      return [
        { file: path.join(directory, 'settings.json'), scope: 'project', project },
        { file: path.join(directory, 'settings.local.json'), scope: 'project-local', project },
      ];
    }),
  ];
  const rules = [];
  for (const source of sources) {
    const permissions = readPermissions(source.file);
    if (!permissions) continue;
    for (const action of ['allow', 'deny']) {
      const actionRules = Array.isArray(permissions[action]) ? permissions[action] : [];
      for (const rule of actionRules) {
        if (typeof rule !== 'string' || !rule.trim()) continue;
        rules.push({
          action,
          rule: rule.trim(),
          scope: source.scope,
          project: source.project,
          source: path.basename(source.file),
        });
      }
    }
  }

  const findings = [];
  const exact = new Map();
  const byRule = new Map();
  for (const rule of rules) {
    const exactKey = `${rule.action}:${rule.rule}`;
    exact.set(exactKey, [...(exact.get(exactKey) || []), rule]);
    byRule.set(rule.rule, [...(byRule.get(rule.rule) || []), rule]);
  }
  for (const entries of exact.values()) {
    if (entries.length < 2) continue;
    findings.push({
      code: 'duplicate-rule',
      level: 'warn',
      rule: entries[0].rule,
      message: `${entries[0].action} rule is repeated in ${entries.length} settings scopes: ${entries[0].rule}`,
    });
  }
  for (const [rule, entries] of byRule) {
    if (!entries.some((entry) => entry.action === 'allow')
      || !entries.some((entry) => entry.action === 'deny')) continue;
    findings.push({
      code: 'shadowed-rule',
      level: 'warn',
      rule,
      message: `Rule appears in both allow and deny lists: ${rule}`,
    });
  }
  return { rules, findings };
}

module.exports = {
  permissionsView,
  readPermissions,
};
