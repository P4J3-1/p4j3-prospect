const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldPreventSuspension } = require('../utils/background-holds');

describe('background holds', () => {
  it('holds while a campaign is running or scheduled', () => {
    assert.equal(shouldPreventSuspension({ campaigns: [{ status: 'running' }] }), true);
    assert.equal(shouldPreventSuspension({ campaigns: [{ status: 'scheduled' }] }), true);
  });

  it('releases when everything is idle, paused or done', () => {
    assert.equal(shouldPreventSuspension({ campaigns: [] }), false);
    assert.equal(
      shouldPreventSuspension({ campaigns: [{ status: 'paused' }, { status: 'completed' }, { status: 'ready' }] }),
      false,
    );
    assert.equal(shouldPreventSuspension({}), false);
  });

  it('holds while any scrape is active', () => {
    assert.equal(shouldPreventSuspension({ campaigns: [], activeScrapes: 1 }), true);
    assert.equal(shouldPreventSuspension({ campaigns: [], activeScrapes: 0 }), false);
  });
});
