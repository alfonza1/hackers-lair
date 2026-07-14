function projectRecency(project) {
  const timestamp = Number(project.lastStartedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareProjectsForDisplay(left, right) {
  const runningDifference = Number(Boolean(right.running)) - Number(Boolean(left.running));
  if (runningDifference) return runningDifference;
  return projectRecency(right) - projectRecency(left);
}

module.exports = { compareProjectsForDisplay };
