const HARNESSES = Object.freeze(['agents', 'claude', 'codex']);

function harnessParity(skills) {
  const counts = Object.fromEntries(HARNESSES.map((harness) => [harness, 0]));
  const exclusive = [];
  const matrix = (skills || []).map((skill) => {
    const visible = [...new Set(skill.harnesses || [])].filter((value) => HARNESSES.includes(value));
    visible.forEach((harness) => { counts[harness] += 1; });
    if (visible.length === 1) exclusive.push({ name: skill.name, harness: visible[0] });
    return {
      name: skill.name,
      agents: visible.includes('agents'),
      claude: visible.includes('claude'),
      codex: visible.includes('codex'),
    };
  });
  return { counts, exclusive, matrix };
}

module.exports = { HARNESSES, harnessParity };
