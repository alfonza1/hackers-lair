const HARNESSES = Object.freeze(['agents', 'claude', 'codex']);

function harnessParity(skills) {
  const counts = Object.fromEntries(HARNESSES.map((harness) => [harness, 0]));
  const exclusive = [];
  const grouped = new Map();
  for (const skill of skills || []) {
    const key = String(skill.name || '').toLowerCase();
    if (!key) continue;
    const entry = grouped.get(key) || { name: skill.name, harnesses: new Set() };
    for (const harness of skill.harnesses || []) entry.harnesses.add(harness);
    grouped.set(key, entry);
  }
  const matrix = [...grouped.values()].map((skill) => {
    const visible = [...skill.harnesses].filter((value) => HARNESSES.includes(value));
    visible.forEach((harness) => { counts[harness] += 1; });
    if (visible.length === 1) exclusive.push({ name: skill.name, harness: visible[0] });
    return {
      name: skill.name,
      agents: visible.includes('agents'),
      claude: visible.includes('claude'),
      codex: visible.includes('codex'),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  return { counts, exclusive, matrix };
}

module.exports = { HARNESSES, harnessParity };
