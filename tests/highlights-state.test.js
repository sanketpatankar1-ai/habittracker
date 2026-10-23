import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDashboardAnalytics } from '../src/features/analytics/calculations.js';
import { createTrackerState, selectMonth } from '../src/features/state/trackerState.js';

const habit = { id: 'h1', title: 'Walk', startDate: '2026-10-01', schedule: [0, 1, 2, 3, 4, 5, 6] };

test('highlights rank exact rates and compare only real logged sleep records', () => {
  const result = calculateDashboardAnalytics({
    habits: [habit, { ...habit, id: 'h2', title: 'Read' }],
    checksData: { '2026-9': { h1: { 2: true, 3: true }, h2: { 2: true } } },
    sleepData: { '2026-9': { 2: 8, 3: 4, 4: '', 5: 0 } },
    year: 2026, month: 9, now: new Date(2026, 9, 17, 12),
  });
  assert.equal(result.highlights.topHabits[0].id, 'h1');
  assert.ok(Math.abs(result.highlights.topHabits[0].percentage - (200 / 17)) < 1e-10);
  assert.equal(result.highlights.bestWeekday.weekday, 5); // Saturday, the only valid completed weekday.
  assert.equal(result.highlights.sleepComparison, null); // One logged night per band is insufficient.
});

test('sleep comparison counts zero as a recorded short night, not as missing data', () => {
  const result = calculateDashboardAnalytics({
    habits: [habit], checksData: { '2026-9': { h1: { 2: true, 4: true, 5: false, 6: false } } },
    sleepData: { '2026-9': { 2: 8, 4: 9, 5: 0, 6: 4, 7: '' } },
    year: 2026, month: 9, now: new Date(2026, 9, 17, 12),
  });
  assert.equal(result.highlights.sleepComparison.restedNights, 2);
  assert.equal(result.highlights.sleepComparison.shorterNights, 2);
  assert.equal(result.highlights.sleepComparison.difference, 100);
});

test('tracker state is the single mutable source for selected month and records', () => {
  const state = createTrackerState(new Date(2026, 9, 17));
  state.checksData['2026-9'] = { h1: { 17: true } };
  assert.equal(selectMonth(state, 2026, 10), true);
  assert.equal(state.month, 10);
  assert.equal(state.checksData['2026-9'].h1[17], true);
  assert.equal(selectMonth(state, 2026, 12), false);
  assert.equal(state.month, 10);
});

