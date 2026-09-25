const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let splitBatchInput;
let buildExtractionTargets;
let MAX_MATRIX_TARGETS;

before(async () => {
  const mod = await import('../renderer/src/batchSplit.mjs');
  ({ splitBatchInput, buildExtractionTargets, MAX_MATRIX_TARGETS } = mod);
});

describe('batch split', () => {
  it('splits niches pasted with commas', () => {
    assert.deepEqual(splitBatchInput('dentistas, advogados, pizzarias'), [
      'dentistas',
      'advogados',
      'pizzarias',
    ]);
  });

  it('accepts semicolons and newlines as separators', () => {
    assert.deepEqual(splitBatchInput('Copacabana;\nPinheiros\n\nCentro;'), [
      'Copacabana',
      'Pinheiros',
      'Centro',
    ]);
  });

  it('drops empties and accent-insensitive duplicates', () => {
    assert.deepEqual(splitBatchInput('Advogados, advogados, ADVOCACIA, advocacia, ,'), [
      'Advogados',
      'ADVOCACIA',
    ]);
  });

  it('respects the max cap', () => {
    const many = Array.from({ length: 60 }, (_, i) => `nicho${i}`).join(',');
    assert.equal(splitBatchInput(many, { max: 10 }).length, 10);
  });

  it('builds the niche x neighborhood matrix', () => {
    const targets = buildExtractionTargets(['a', 'b'], ['x', 'y']);
    assert.deepEqual(targets.map((t) => t.key), ['a||x', 'a||y', 'b||x', 'b||y']);
  });

  it('falls back to whole municipality without neighborhoods', () => {
    assert.deepEqual(buildExtractionTargets(['a'], []), [
      { niche: 'a', neighborhood: '', key: 'a||' },
    ]);
  });

  it('caps giant matrices', () => {
    const niches = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const neighs = Array.from({ length: 40 }, (_, i) => `b${i}`);
    assert.equal(buildExtractionTargets(niches, neighs).length, MAX_MATRIX_TARGETS);
  });
});
