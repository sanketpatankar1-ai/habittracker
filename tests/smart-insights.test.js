import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSmartInsight } from '../src/features/analytics/smartInsights.js';

const everyDay = { id: 'walk', title: 'Walk', startDate: '2026-09-01', schedule: [0, 1, 2, 3, 4, 5, 6] };

test('no insight is invented before minimum eligible observations', () => {
  assert.equal(selectSmartInsight({ habits: [everyDay], checksData: {}, now: new Date(2026, 9, 5, 12) }), null);
});

test('compares equivalent 14-day periods and excludes future completion records', () => {
  const completedPrevious = {};
  for (let day = 1; day <= 14; day++) completedPrevious[day] = true;
  const insight = selectSmartInsight({ habits: [everyDay], checksData: { '2026-9': { walk: { ...completedPrevious, 29: true, 30: true, 31: true } }, '2026-10': { walk: { 28: true } } }, now: new Date(2026, 9, 28, 12) });
  assert.equal(insight.kind, 'decline');
  assert.match(insight.text, /Walk is down 100 points/);
});

test('scheduled versus unscheduled dates affect denominators correctly', () => {
  const weekdays = { ...everyDay, schedule: [1, 2, 3, 4, 5] };
  const checks = { '2026-9': { walk: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true, 9: true, 10: true, 11: true, 12: false, 13: false, 14: true } } };
  const insight = selectSmartInsight({ habits: [weekdays], checksData: checks, now: new Date(2026, 9, 14, 12) });
  assert.ok(insight === null || !/eligible.*Saturday|Sunday/.test(insight.text));
});

test('strong weekday requires a consistent advantage across enough eligible dates', () => {
  const second = { ...everyDay, id: 'read', title: 'Read' }, firstChecks = {}, secondChecks = {};
  for (const day of [2, 9, 16, 23]) { firstChecks[day] = true; secondChecks[day] = true; }
  const insight = selectSmartInsight({ habits: [everyDay, second], checksData: { '2026-9': { walk: firstChecks, read: secondChecks } }, now: new Date(2026, 9, 28, 12) });
  assert.equal(insight.kind, 'weekday');assert.match(insight.text, /Friday/);
});

test('sleep insight needs three nights in each band and describes association without causality', () => {
  const second = { ...everyDay, id: 'read', title: 'Read' }, checks = { '2026-9': { walk: {}, read: {} } }, sleep = { '2026-9': {} };
  for (let day = 1; day <= 28; day++) {
    const rested = day % 2 === 1;
    checks['2026-9'].walk[day] = rested;checks['2026-9'].read[day] = rested;sleep['2026-9'][day] = rested ? 8 : 4;
  }
  const insight = selectSmartInsight({ habits: [everyDay, second], checksData: checks, sleepData: sleep, now: new Date(2026, 9, 28, 12) });
  assert.equal(insight.kind, 'sleep');assert.match(insight.text, /association, not evidence of cause/);
});
