const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  readWindowState,
  resolveBounds,
  writeWindowState,
} = require('../utils/window-state');

const displays = [
  { id: 1, primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { id: 2, primary: false, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } },
];

test('keeps a window visible on an available monitor', () => {
  const bounds = resolveBounds({ x: 2060, y: 90, width: 1200, height: 800 }, displays);
  assert.deepEqual(bounds, { x: 2060, y: 90, width: 1200, height: 800 });
});

test('recovers an off-screen window to the primary work area', () => {
  const bounds = resolveBounds({ x: 8000, y: 200, width: 1200, height: 800 }, displays);
  assert.deepEqual(bounds, { x: 360, y: 120, width: 1200, height: 800 });
});

test('clamps an invalid restored size to desktop constraints', () => {
  const bounds = resolveBounds({ x: 20, y: 20, width: 40, height: 40 }, displays);
  assert.deepEqual(bounds, { x: 20, y: 20, width: 900, height: 600 });
});

test('persists a sanitized versioned window state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-window-state-'));
  try {
    const saved = writeWindowState(root, {
      bounds: { x: -9999, y: 0, width: 1200, height: 800 },
      isMaximized: true,
    }, displays);
    const restored = readWindowState(root, displays);
    assert.equal(saved.version, 1);
    assert.equal(restored.isMaximized, true);
    assert.deepEqual(restored.bounds, { x: 360, y: 120, width: 1200, height: 800 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
