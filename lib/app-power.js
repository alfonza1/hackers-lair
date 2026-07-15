const POWER_ACTIONS = new Set(['restart', 'shutdown']);

function performPowerAction(action, electronApp) {
  if (!POWER_ACTIONS.has(action)) return false;
  if (action === 'restart') electronApp.relaunch();
  electronApp.exit(0);
  return true;
}

module.exports = { performPowerAction };
