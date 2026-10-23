import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDashboardAnalytics, buildMonthlyReportData, getDaysInMonth, getWeekRanges } from '../src/features/analytics/calculations.js';

const today = new Date(2026, 9, 17, 12);
const habit = { id: 'h1', title: 'Read', emoji: '📖', startDate: '2026-10-01', schedule: [0, 1, 2, 3, 4, 5, 6] };

test('future pre-marks are planned and included in projected month overall, not completed count', () => {
  const result = calculateDashboardAnalytics({ habits: [habit], checksData: { '2026-9': { h1: { 2: true, 17: true, 31: true } } }, year: 2026, month: 9, now: today });
  assert.equal(result.done, 2);
  assert.equal(result.planned, 1);
  assert.equal(result.monthGoal, 31);
  assert.equal(result.remaining, 28);
  assert.ok(Math.abs(result.overallPercent - (300 / 31)) < 1e-10);
  assert.equal(result.dailyRates[16], 100);
});

test('planned checks render in the correct fifth week and day bar', () => {
  const result = calculateDashboardAnalytics({ habits: [habit], checksData: { '2026-9': { h1: { 29: true } } }, year: 2026, month: 9, now: today });
  assert.equal(result.weekly.length, 5);
  assert.equal(result.weekly[4].plannedDone, 1);
  assert.equal(result.weekly[4].start, 25);
  assert.equal(result.weekly[4].plannedGoal, 7);
  assert.ok(Math.abs(result.weekly[4].rate - (100 / 7)) < 1e-10);
  assert.equal(result.dailyBars[28], 100);
  assert.equal(result.dailyRates[28], null);
});

test('a future month has no actual progress until the month begins', () => {
  const result = calculateDashboardAnalytics({ habits: [habit], checksData: {}, year: 2026, month: 11, now: today });
  assert.equal(result.done, 0);
  assert.equal(result.planned, 0);
  assert.equal(result.overallPercent, 0);
  assert.ok(result.dailyRates.every((value) => value === null));
});

test('monthly report excludes future and pre-start checks', () => {
  const result = buildMonthlyReportData({ habits: [{ ...habit, startDate: '2026-10-05' }], archivedHabits: [], checksData: { '2026-9': { h1: { 2: true, 5: true, 17: true, 20: true } } }, moodData: {}, sleepData: {}, year: 2026, month: 9, now: today });
  assert.equal(result.rows[0].goal, 13);
  assert.equal(result.rows[0].done, 2);
  assert.equal(result.rows[0].missed, 11);
});

test('zero habits and zero eligible occurrences return finite empty metrics', () => {
  const noHabits = calculateDashboardAnalytics({ habits: [], checksData: {}, year: 2026, month: 9, now: today });
  assert.equal(noHabits.monthGoal, 0); assert.equal(noHabits.overallPercent, 0); assert.equal(noHabits.done, 0);
  const noSchedule = calculateDashboardAnalytics({ habits: [{ ...habit, schedule: [] }], checksData: {}, year: 2026, month: 9, now: today });
  assert.equal(noSchedule.monthGoal, 0); assert.equal(noSchedule.averageDailyRate, 0);
  for (const result of [noHabits, noSchedule]) assert.ok(JSON.stringify(result).indexOf('NaN') < 0);
});

test('daily and habit rates use only scheduled eligible occurrences and keep calculation precision', () => {
  const habits = [
    { ...habit, schedule: [1, 3] },
    { id: 'h2', title: 'Stretch', startDate: '2026-10-01', schedule: [1] },
  ];
  // Oct 5 is Monday; Oct 7 is Wednesday. One of two occurrences is complete.
  const result = calculateDashboardAnalytics({ habits, checksData: { '2026-9': { h1: { 5: true }, h2: {} } }, year: 2026, month: 9, now: new Date(2026, 9, 7, 12) });
  assert.equal(result.dailyRates[4], 50);
  assert.equal(result.habitStats.find((entry) => entry.id === 'h1').percentage, 50);
  assert.equal(result.habitStats.find((entry) => entry.id === 'h2').goal, 1);
  assert.equal(result.dailyRates[5], null); // Tuesday has no eligible scheduled habit.
});

test('a single completed eligible occurrence yields a 100 percent daily rate and partial calendar week rate', () => {
  const fridayHabit = { ...habit, schedule: [5] };
  const result = calculateDashboardAnalytics({ habits: [fridayHabit], checksData: { '2026-9': { h1: { 2: true } } }, year: 2026, month: 9, now: new Date(2026, 9, 2, 12) });
  assert.equal(result.dailyRates[1], 100);
  assert.equal(result.weekly[0].done, 1);
  assert.equal(result.weekly[0].goal, 1);
  assert.equal(result.weekly[0].rate, 100);
});

test('calendar weeks handle partial boundaries and weeks spanning month edges', () => {
  assert.deepEqual(getWeekRanges(2026, 9), [{ start: 1, end: 3 }, { start: 4, end: 10 }, { start: 11, end: 17 }, { start: 18, end: 24 }, { start: 25, end: 31 }]);
  assert.equal(getWeekRanges(2026, 0)[0].start, 1);
  const result = calculateDashboardAnalytics({ habits: [habit], checksData: { '2026-9': { h1: { 31: true } }, '2026-10': { h1: { 1: true } } }, year: 2026, month: 9, now: new Date(2026, 10, 2, 12) });
  assert.equal(result.done, 1); // October 31 is included; November 1 stays in the November record.
  assert.equal(result.weekly.length, 5);
  assert.equal(getWeekRanges(2021, 4).length, 6); // Saturday-starting 31-day month has six calendar weeks.
});

test('February day counts respect leap years', () => {
  assert.equal(getDaysInMonth(2024, 1), 29);
  assert.equal(getDaysInMonth(2025, 1), 28);
  const leap = calculateDashboardAnalytics({ habits: [{ ...habit, startDate: '2024-02-01' }], checksData: {}, year: 2024, month: 1, now: new Date(2024, 1, 29, 12) });
  assert.equal(leap.monthGoal, 29);
});

test('archived habits do not enter active dashboard goals but reports retain history until archive date', () => {
  const archived = { ...habit, archivedAt: '2026-10-10' };
  const active = calculateDashboardAnalytics({ habits: [], checksData: {}, year: 2026, month: 9, now: today });
  const report = buildMonthlyReportData({ habits: [], archivedHabits: [archived], checksData: { '2026-9': { h1: { 5: true, 12: true } } }, moodData: {}, sleepData: {}, year: 2026, month: 9, now: today });
  assert.equal(active.monthGoal, 0);
  assert.equal(report.rows[0].done, 1);
  assert.equal(report.rows[0].goal, 10);
});

test('month switching reads only the selected month and checkbox changes recalculate totals', () => {
  const checksData = { '2026-9': { h1: { 3: true } }, '2026-10': { h1: { 3: true, 4: true } } };
  const now = new Date(2026, 10, 10, 12);
  const october = calculateDashboardAnalytics({ habits: [habit], checksData, year: 2026, month: 9, now });
  const november = calculateDashboardAnalytics({ habits: [habit], checksData, year: 2026, month: 10, now });
  assert.equal(october.done, 1); assert.equal(november.done, 2);
  checksData['2026-9'].h1[4] = true;
  const updated = calculateDashboardAnalytics({ habits: [habit], checksData, year: 2026, month: 9, now });
  assert.equal(updated.done, 2); assert.ok(updated.overallPercent > october.overallPercent);
});

test('seven calendar-day moving average ignores dates with no eligible occurrences', () => {
  const scheduled = { ...habit, schedule: [1, 3, 5] };
  const result = calculateDashboardAnalytics({ habits: [scheduled], checksData: { '2026-9': { h1: { 5: true } } }, year: 2026, month: 9, now: new Date(2026, 9, 10, 12) });
  assert.equal(result.dailyAverage[4], 50);
  assert.equal(result.dailyAverage[5], 50); // no eligible Tuesday is omitted from the rolling mean.
  assert.ok(Math.abs(result.dailyAverage[9] - (100 / 3)) < 1e-10); // valid eligible days Oct 5 and Oct 7/9 in the trailing seven dates.
});

test('seven-day average equally weights valid daily rates when daily habit counts differ', () => {
  const habits = [
    { ...habit, schedule: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'monday', title: 'Monday', startDate: '2026-10-01', schedule: [1] },
  ];
  const checksData = { '2026-9': { h1: { 6: true, 7: true, 8: true, 9: true, 10: true, 11: true }, monday: { 5: true } } };
  const result = calculateDashboardAnalytics({ habits, checksData, year: 2026, month: 9, now: new Date(2026, 9, 11, 12) });
  assert.ok(Math.abs(result.dailyAverage[10] - (650 / 7)) < 1e-10);
});

test('seven-day average spans the previous month boundary', () => {
  const checksData = {
    '2026-9': { h1: { 27: true, 28: true, 29: true, 30: true, 31: true } },
    '2026-10': { h1: { 1: true } },
  };
  const result = calculateDashboardAnalytics({ habits: [habit], checksData, year: 2026, month: 10, now: new Date(2026, 10, 2, 12) });
  assert.ok(Math.abs(result.dailyAverage[1] - (600 / 7)) < 1e-10);
});

test('invalid selected month returns safe finite empty analytics', () => {
  const result = calculateDashboardAnalytics({ habits: [habit], checksData: {}, year: 2026, month: 12, now: today });
  assert.equal(result.monthGoal, 0); assert.equal(result.overallPercent, 0); assert.deepEqual(result.dailyRates, []);
});


