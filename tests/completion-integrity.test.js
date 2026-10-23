import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDashboardAnalytics, buildMonthlyReportData, dateFor, isHabitEligibleOnDate } from '../src/features/analytics/calculations.js';
import { persistCompletion } from '../src/features/tracking/completions.js';
import { buildMonthlyCsv } from '../src/features/exports/monthlyExports.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const day = (d) => `2026-10-${String(d).padStart(2, '0')}`;
const habits = Array.from({ length: 5 }, (_, i) => ({
  id: `h${i + 1}`, title: `Habit ${i + 1}`, startDate: day(1), schedule: [0, 1, 2, 3, 4, 5, 6],
  inactivePeriods: [{ startDate: day(8), endDate: '2026-10-31' }],
}));
const analyze = (checksData, habitSet = habits) => calculateDashboardAnalytics({ habits: habitSet, checksData, year: 2026, month: 9, now: new Date(2026, 10, 1, 12) });

test('all 35 eligible opportunities yield 35/35 and 100 percent', () => {
  const checksData = { '2026-9': Object.fromEntries(habits.map((habit) => [habit.id, Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i + 1, true]))])) };
  const result = analyze(checksData);
  assert.equal(result.monthGoal, 35);
  assert.equal(result.done, 35);
  assert.equal(result.remaining, 0);
  assert.equal(result.overallPercent, 100);
});

test('10 of 35 opportunities yield exact partial completion', () => {
  const checksData = { '2026-9': Object.fromEntries(habits.map((habit, hi) => [habit.id, Object.fromEntries(Array.from({ length: 7 }, (_, di) => [di + 1, hi * 7 + di < 10]))])) };
  const result = analyze(checksData);
  assert.equal(result.monthGoal, 35);
  assert.equal(result.done, 10);
  assert.equal(result.remaining, 25);
  assert.equal(result.overallPercent, 10 / 35 * 100);
});

test('screenshot scenario reconciles 38 done, 35 planned, and 41 left out of 114', () => {
  const snapshotHabits = [
    { id: 'bath', title: 'bath', startDate: day(1), schedule: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'gym', title: 'gym', startDate: day(1), schedule: [0, 1, 2, 3, 4, 5, 6] },
    ...['drink', 'walk', 'journal', 'stretch'].map((id) => ({ id, title: id, startDate: day(19), schedule: [0, 1, 2, 3, 4, 5, 6] })),
  ];
  const records = { bath: {}, gym: {}, drink: {}, walk: {}, journal: {}, stretch: {} };
  for (let d = 1; d <= 19; d++) { records.bath[d] = true; records.gym[d] = true; }
  for (let d = 20; d <= 31; d++) { records.bath[d] = true; records.gym[d] = true; }
  for (let d = 20; d <= 22; d++) { records.drink[d] = true; records.walk[d] = true; records.journal[d] = true; }
  records.stretch[20] = true; records.stretch[21] = true;
  const result = calculateDashboardAnalytics({ habits: snapshotHabits, checksData: { '2026-9': records }, year: 2026, month: 9, now: new Date(2026, 9, 19, 12) });
  assert.equal(result.monthGoal, 114);
  assert.equal(result.done, 38);
  assert.equal(result.planned, 35);
  assert.equal(result.remaining, 41);
  assert.equal(result.overallPercent, (38 + 35) / 114 * 100);
  const afterOneTick = structuredClone(records);
  afterOneTick.drink[19] = true;
  const withOneTick = calculateDashboardAnalytics({ habits: snapshotHabits, checksData: { '2026-9': afterOneTick }, year: 2026, month: 9, now: new Date(2026, 9, 19, 12) });
  const justStarted = withOneTick.habitStats.find((habit) => habit.id === 'drink');
  assert.equal(justStarted.actual, 1);
  assert.equal(justStarted.goal, 1);
  assert.equal(justStarted.percentage, 100); // 100% of eligible days through today, not of the full month.
  assert.ok(withOneTick.overallPercent < 100);
  assert.equal(withOneTick.dailyDone[18], 3);
  assert.equal(withOneTick.dailyGoal[18], 6);
  assert.equal(withOneTick.dailyRates[18], 3 / 6 * 100); // Daily progress uses the full eligible-habit denominator.
  assert.equal(isHabitEligibleOnDate(snapshotHabits[2], dateFor(2026, 9, 18)), false);
  assert.equal(isHabitEligibleOnDate(snapshotHabits[2], dateFor(2026, 9, 19)), true);
});

test('rapid check/uncheck persists each latest value exactly once and feeds analytics from that record', () => {
  const checksData = {}, storage = new MemoryStorage();
  const persist = (value) => { storage.setItem('checks', JSON.stringify(value)); return true; };
  for (const checked of [true, false, true, true, false, true]) assert.equal(persistCompletion(checksData, '2026-9', 'h1', 1, checked, persist), true);
  assert.deepEqual(JSON.parse(storage.getItem('checks')), checksData);
  const result = analyze(checksData, [habits[0]]);
  assert.equal(result.done, 1);
  assert.equal(result.habitStats[0].actual, 1);
});

test('failed persistence restores prior state including absent keys and makes no analytics contribution', () => {
  const checksData = {};
  assert.equal(persistCompletion(checksData, '2026-9', 'h1', 1, true, () => false), false);
  assert.deepEqual(checksData, {});
  assert.equal(analyze(checksData, [habits[0]]).done, 0);
  checksData['2026-9'] = { h1: { 1: false } };
  assert.equal(persistCompletion(checksData, '2026-9', 'h1', 1, true, () => { throw new Error('quota'); }), false);
  assert.equal(checksData['2026-9'].h1[1], false);
});

test('save and refresh round trip retains the same completion and dependent counts', () => {
  const checksData = {}, storage = new MemoryStorage();
  assert.equal(persistCompletion(checksData, '2026-9', 'h1', 3, true, (value) => { storage.setItem('ht_checks', JSON.stringify(value)); return true; }), true);
  const refreshed = JSON.parse(storage.getItem('ht_checks'));
  assert.deepEqual(analyze(refreshed, [habits[0]]), analyze(checksData, [habits[0]]));
  assert.equal(refreshed['2026-9'].h1[3], true);
});

test('non-boolean truthy records never appear checked or inflate dashboard and report counts', () => {
  const malformed = { '2026-9': { h1: { 1: 'true', 2: 1, 3: 'false', 4: true } } };
  const oneHabit = [habits[0]], result = analyze(malformed, oneHabit);
  assert.equal(result.done, 1);
  assert.equal(result.habitStats[0].actual, 1);
  const report = buildMonthlyReportData({ habits: oneHabit, archivedHabits: [], checksData: malformed, moodData: {}, sleepData: {}, year: 2026, month: 9, now: new Date(2026, 10, 1, 12) });
  assert.equal(report.rows[0].done, 1);
  const csv = buildMonthlyCsv({ report, habits: oneHabit, checksData: malformed });
  assert.match(csv, /"2026-10-01","h1","Habit 1","","Not completed"/);
  assert.match(csv, /"2026-10-04","h1","Habit 1","","Completed"/);
});

test('analytics invariants hold and recalculation is deterministic', () => {
  const checksData = { '2026-9': Object.fromEntries(habits.map((habit) => [habit.id, { 1: true, 2: false, 3: true, 4: true }])) };
  const first = analyze(checksData), second = analyze(checksData);
  assert.deepEqual(second, first);
  assert.ok(first.done <= first.monthGoal);
  assert.ok(first.remaining >= 0);
  assert.equal(first.done + first.planned + first.remaining, first.monthGoal);
  assert.ok(first.overallPercent >= 0 && first.overallPercent <= 100);
  assert.equal(analyze(checksData, [...habits].reverse()).done, first.done);
});
