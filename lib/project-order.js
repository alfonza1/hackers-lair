function projectRecency(project) {
  for (const value of [project.lastActionAt, project.lastStartedAt]) {
    const timestamp = Number(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function compareProjectsForDisplay(left, right) {
  const runningDifference = Number(Boolean(right.running)) - Number(Boolean(left.running));
  if (runningDifference) return runningDifference;
  return projectRecency(right) - projectRecency(left);
}

module.exports = { compareProjectsForDisplay };
