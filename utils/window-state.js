const fs = require('fs');
const path = require('path');

const WINDOW_STATE_VERSION = 1;
const DEFAULT_WINDOW_BOUNDS = Object.freeze({
  width: 1200,
  height: 800,
  minWidth: 900,
  minHeight: 600,
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function normalizeWorkArea(value = {}) {
  const width = Math.max(1, finite(value.width, 1920));
  const height = Math.max(1, finite(value.height, 1080));
  return {
    x: finite(value.x, 0),
    y: finite(value.y, 0),
    width,
    height,
  };
}

function overlap(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function centerBounds(workArea, width, height) {
  const area = normalizeWorkArea(workArea);
  const nextWidth = Math.min(width, area.width);
  const nextHeight = Math.min(height, area.height);
  return {
    x: Math.round(area.x + (area.width - nextWidth) / 2),
    y: Math.round(area.y + (area.height - nextHeight) / 2),
    width: nextWidth,
    height: nextHeight,
  };
}

function resolveBounds(input = {}, displays = [], defaults = DEFAULT_WINDOW_BOUNDS) {
  const minWidth = Math.max(1, finite(defaults.minWidth, DEFAULT_WINDOW_BOUNDS.minWidth));
  const minHeight = Math.max(1, finite(defaults.minHeight, DEFAULT_WINDOW_BOUNDS.minHeight));
  const primary = displays.find((display) => display?.primary) || displays[0] || { workArea: {} };
  const primaryWorkArea = normalizeWorkArea(primary.workArea);
  const width = Math.min(primaryWorkArea.width, Math.max(minWidth, finite(input.width, defaults.width)));
  const height = Math.min(primaryWorkArea.height, Math.max(minHeight, finite(input.height, defaults.height)));
  const candidate = {
    x: finite(input.x, Number.NaN),
    y: finite(input.y, Number.NaN),
    width,
    height,
  };

  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
    return centerBounds(primaryWorkArea, width, height);
  }

  const visible = displays.some((display) => overlap(candidate, normalizeWorkArea(display?.workArea)) >= 64);
  if (!visible) {
    return centerBounds(primaryWorkArea, width, height);
  }

  return candidate;
}

function normalizeWindowState(input = {}, displays = [], defaults = DEFAULT_WINDOW_BOUNDS) {
  const bounds = resolveBounds(input?.bounds || input, displays, defaults);
  const matchingDisplay = displays.find((display) => overlap(bounds, normalizeWorkArea(display?.workArea)) >= 64);
  return {
    version: WINDOW_STATE_VERSION,
    bounds,
    displayId: matchingDisplay?.id || null,
    isMaximized: Boolean(input?.isMaximized),
  };
}

function getWindowStatePath(userDataPath) {
  return path.join(userDataPath, 'window-state-v1.json');
}

function readWindowState(userDataPath, displays = [], defaults = DEFAULT_WINDOW_BOUNDS) {
  try {
    const raw = JSON.parse(fs.readFileSync(getWindowStatePath(userDataPath), 'utf8'));
    return normalizeWindowState(raw, displays, defaults);
  } catch {
    return normalizeWindowState({}, displays, defaults);
  }
}

function writeWindowState(userDataPath, input, displays = [], defaults = DEFAULT_WINDOW_BOUNDS) {
  const state = normalizeWindowState(input, displays, defaults);
  fs.mkdirSync(userDataPath, { recursive: true });
  const filePath = getWindowStatePath(userDataPath);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  return state;
}

module.exports = {
  DEFAULT_WINDOW_BOUNDS,
  WINDOW_STATE_VERSION,
  centerBounds,
  getWindowStatePath,
  normalizeWindowState,
  overlap,
  readWindowState,
  resolveBounds,
  writeWindowState,
};
