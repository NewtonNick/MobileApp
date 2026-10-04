import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  axisTicks,
  compactUsd,
  domainOf,
  fractionalIndex,
  fromToday,
  periodChanges,
  plottedSeries,
  rangeSpans,
  widestGap,
  widestSpread,
  yearMarks,
} from './scale.ts';

describe('chart scale', () => {
  it('pins zero when cash rises off a small balance', () => {
    const domain = domainOf([[2_000, 40_000]]);
    assert.equal(domain.min, 0);
    assert.ok(domain.max > 40_000);
  });

  it('keeps a tight band far from zero on its own scale', () => {
    const domain = domainOf([[400_000, 420_000]]);
    assert.ok(domain.min > 300_000);
    assert.ok(domain.max < 460_000);
  });

  it('includes zero when the series crosses it', () => {
    const domain = domainOf([[-5_000, 10_000]]);
    assert.ok(domain.min < 0);
    assert.ok(domain.max > 0);
  });

  it('places a few dollar ticks inside the domain', () => {
    const ticks = axisTicks(0, 108_000, 3);
    assert.ok(ticks.length >= 2);
    assert.ok(ticks.every((tick) => tick >= 0 && tick <= 108_000));
    assert.equal(ticks[0], 0);
  });

  it('compacts axis amounts', () => {
    assert.equal(compactUsd(0), '$0');
    assert.equal(compactUsd(1500), '$1.5k');
    assert.equal(compactUsd(12_000), '$12k');
    assert.equal(compactUsd(1_250_000), '$1.3M');
    assert.equal(compactUsd(-4000), '-$4k');
  });

  it('labels the first month of each new year', () => {
    const marks = yearMarks([1, 12, 13, 24], new Date(2026, 0, 15));
    assert.deepEqual(
      marks.map((mark) => mark.label),
      ['2026', '2027'],
    );
  });

  it('draws a long path as year-ends and keeps the hired month', () => {
    const months = Array.from({ length: 120 }, (_, i) => i + 1);
    const plotted = plottedSeries(months, months.map(() => 1), [84]);
    assert.ok(plotted.length < 20);
    assert.equal(plotted[0]?.month, 1);
    assert.equal(plotted.at(-1)?.month, 120);
    assert.ok(plotted.some((point) => point.month === 84));
  });

  it('keeps a five-year path monthly', () => {
    const months = Array.from({ length: 60 }, (_, i) => i + 1);
    assert.equal(plottedSeries(months, months, []).length, 60);
  });

  it('places a month between year points', () => {
    const index = fractionalIndex([1, 12, 24], 18);
    assert.ok(index != null && index > 1 && index < 2);
  });

  it('measures the widest gap between two paths', () => {
    assert.equal(widestGap([10, 30], [12, 10]), 20);
  });

  it('measures how far three paths spread', () => {
    assert.equal(widestSpread([[0, 100], [0, 0], [0, -50]]), 150);
  });

  it('measures month-to-month change on a short path', () => {
    assert.deepEqual(periodChanges([1, 2, 3], [10, 12, 9]), [
      { month: 2, value: 2 },
      { month: 3, value: -3 },
    ]);
  });

  it('measures year-end change on a long path', () => {
    const months = Array.from({ length: 24 }, (_, index) => index + 1);
    const values = months.map((month) => month * 10);
    const changes = periodChanges(months, values);
    assert.equal(changes.length, 2);
    assert.equal(changes[0]?.month, 12);
    assert.equal(changes[0]?.value, 110);
    assert.equal(changes[1]?.month, 24);
    assert.equal(changes[1]?.value, 120);
  });

  it('spans a long path by year, from the low to the high', () => {
    const months = Array.from({ length: 24 }, (_, index) => index + 1);
    const values = months.map((month) => (month === 6 ? 1 : month === 20 ? 400 : 100));
    const spans = rangeSpans(months, values);
    assert.equal(spans.length, 2);
    assert.equal(spans[0]?.low, 1);
    assert.equal(spans[0]?.high, 100);
    assert.equal(spans[0]?.close, 100);
    assert.equal(spans[1]?.high, 400);
  });

  it('rebases a path on today’s balance', () => {
    assert.deepEqual(fromToday([100, 110, 90]), [0, 10, -10]);
  });
});
