const THEMES = Object.freeze(['phosphor', 'amber', 'ice', 'crimson', 'ghost']);
const DENSITIES = Object.freeze(['comfortable', 'compact']);
const MOTION_LEVELS = Object.freeze(['full', 'reduced']);
const FONT_SCALES = Object.freeze([90, 100, 110]);

const DEFAULT_UI_PREFERENCES = Object.freeze({
  theme: 'phosphor',
  density: 'comfortable',
  motion: 'full',
  fontScale: 100,
});

function normalizeUiPreferences(value = {}) {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fontScale = Number(candidate.fontScale);
  return {
    theme: THEMES.includes(candidate.theme) ? candidate.theme : DEFAULT_UI_PREFERENCES.theme,
    density: DENSITIES.includes(candidate.density) ? candidate.density : DEFAULT_UI_PREFERENCES.density,
    motion: MOTION_LEVELS.includes(candidate.motion) ? candidate.motion : DEFAULT_UI_PREFERENCES.motion,
    fontScale: FONT_SCALES.includes(fontScale) ? fontScale : DEFAULT_UI_PREFERENCES.fontScale,
  };
}

function validateUiPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('uiPreferences must be an object.');
  }
  if (!THEMES.includes(value.theme)) {
    throw new Error(`uiPreferences.theme must be one of: ${THEMES.join(', ')}.`);
  }
  if (!DENSITIES.includes(value.density)) {
    throw new Error(`uiPreferences.density must be one of: ${DENSITIES.join(', ')}.`);
  }
  if (!MOTION_LEVELS.includes(value.motion)) {
    throw new Error(`uiPreferences.motion must be one of: ${MOTION_LEVELS.join(', ')}.`);
  }
  if (!FONT_SCALES.includes(Number(value.fontScale))) {
    throw new Error(`uiPreferences.fontScale must be one of: ${FONT_SCALES.join(', ')}.`);
  }
}

module.exports = {
  DEFAULT_UI_PREFERENCES,
  DENSITIES,
  FONT_SCALES,
  MOTION_LEVELS,
  normalizeUiPreferences,
  THEMES,
  validateUiPreferences,
};
