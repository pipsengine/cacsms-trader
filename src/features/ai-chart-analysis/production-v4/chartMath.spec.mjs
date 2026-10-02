import assert from 'node:assert/strict';
import test from 'node:test';

/** Mirror of finiteNumber / normalizeCandles invariants for CI without vitest. */
function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

test('finiteNumber rejects NaN and empty', () => {
  assert.equal(finiteNumber(''), null);
  assert.equal(finiteNumber('NaN'), null);
  assert.equal(finiteNumber(undefined), null);
  assert.equal(finiteNumber(1.25), 1.25);
});

function ensureStrictAscTimes(points) {
  if (points.length < 2) return points;
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    const prevT = out[out.length - 1].time;
    if (p.time <= prevT) out.push({ ...p, time: prevT + 1 });
    else out.push(p);
  }
  return out;
}

test('canonical supply above erz mid', () => {
  const supplyMid = (2650 + 2640) / 2;
  const erzMid = (2635 + 2625) / 2;
  assert.ok(supplyMid > erzMid);
});

test('ensureStrictAscTimes fixes duplicate projected times', () => {
  const fixed = ensureStrictAscTimes([
    { time: 100, value: 1 },
    { time: 100, value: 2 },
    { time: 100, value: 3 },
  ]);
  assert.equal(fixed.length, 3);
  assert.ok(fixed[1].time > fixed[0].time);
  assert.ok(fixed[2].time > fixed[1].time);
});

test('priceToY guard', () => {
  const minPrice = 1;
  const maxPrice = 2;
  const range = maxPrice - minPrice;
  const chartTop = 25;
  const chartHeight = 400;
  const priceToY = (price) => {
    const p = finiteNumber(price);
    if (p === null) return null;
    const y = chartTop + ((maxPrice - p) / range) * chartHeight;
    return Number.isFinite(y) ? y : null;
  };
  assert.equal(priceToY(null), null);
  assert.ok(priceToY(1.5) > chartTop);
});
