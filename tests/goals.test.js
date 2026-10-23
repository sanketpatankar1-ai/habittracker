import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteGoal, goalProgress, saveGoal, setGoalActive, setGoalCompleted } from '../src/features/goals/goalData.js';

const habit = { id: 'read', title: 'Read', startDate: '2026-10-01', schedule: [1, 2, 3, 4, 5] };
const base = { title: 'Read 3 times', description: '', type: 'habit', targetDate: '2026-10-20', periodStart: '2026-10-01', habitId: 'read', targetCount: 3 };

test('create, edit, complete, reopen, select, and delete goals', () => {
  const first = saveGoal([], base, { habits: [habit] });
  assert.equal(first.length, 1);assert.equal(first[0].title, 'Read 3 times');assert.equal(first[0].isActive, true);
  const edited = saveGoal(first, { ...base, id: first[0].id, title: 'Read 4 times', targetCount: 4 }, { habits: [habit] });
  assert.equal(edited.length, 1);assert.equal(edited[0].targetCount, 4);
  const second = saveGoal(edited, { ...base, title: 'Walk more', habitId: 'read' }, { habits: [habit] });
  assert.equal(second[1].isActive, false);
  assert.equal(setGoalActive(second, second[1].id)[1].isActive, true);
  const completed = setGoalCompleted(second, second[1].id, true);
  assert.equal(completed[1].status, 'completed');assert.equal(completed[0].isActive, true);
  const editedCompleted = saveGoal(completed, { ...base, id: second[1].id, title: 'Updated completed goal' }, { habits: [habit] });
  assert.equal(editedCompleted[1].status, 'completed');assert.equal(editedCompleted[1].isActive, false);
  assert.equal(setGoalCompleted(completed, second[1].id, false)[1].status, 'active');
  assert.equal(deleteGoal(second, second[0].id)[0].id, second[1].id);
});

test('habit progress counts only true scheduled records in range through today', () => {
  const goal = saveGoal([], base, { habits: [habit] })[0];
  const checksData = { '2026-9': { read: { 1: true, 3: true, 5: true, 19: true } }, '2026-10': { read: { 1: true } } };
  const progress = goalProgress(goal, { habits: [habit], checksData, now: new Date(2026, 9, 17, 12) });
  assert.deepEqual(progress, { count: 2, target: 3, percent: 67, overdue: false, completed: false, daysRemaining: 3 });
  checksData['2026-9'].read[2] = false;
  assert.equal(goalProgress(goal, { habits: [habit], checksData, now: new Date(2026, 9, 17, 12) }).count, 2);
});

test('habit goal shows the target count and correct percent for 13 of 20 checks', () => {
  const many = { ...base, targetDate: '2026-10-31', targetCount: 20 }, goal = saveGoal([], many, { habits: [habit] })[0], days = {};let completed = 0;
  for (let day = 1; day <= 31; day++) if ([1, 2, 3, 4, 5].includes(new Date(2026, 9, day, 12).getDay())) days[day] = completed++ < 13;
  const progress = goalProgress(goal, { habits: [habit], checksData: { '2026-9': { read: days } }, now: new Date(2026, 9, 31, 12) });
  assert.equal(progress.count, 13);assert.equal(progress.target, 20);assert.equal(progress.percent, 65);
});

test('goal validation rejects invalid title, target and period; manual progress stays within its target', () => {
  assert.throws(() => saveGoal([], { ...base, title: '  ' }, { habits: [habit] }), /title/);
  assert.throws(() => saveGoal([], { ...base, targetCount: 0 }, { habits: [habit] }), /target/);
  assert.throws(() => saveGoal([], { ...base, periodStart: '2026-10-21' }, { habits: [habit] }), /start date/);
  const manual = saveGoal([], { title: 'Finish course', type: 'manual', targetDate: '2026-10-20', targetCount: 4, manualProgress: 2 }, { habits: [] })[0];
  assert.deepEqual(goalProgress(manual, { now: new Date(2026, 9, 17, 12) }), { count: 2, target: 4, percent: 50, overdue: false, completed: false, daysRemaining: 3 });
  assert.throws(() => saveGoal([], { ...manual, manualProgress: 5 }, { habits: [] }), /Progress/);
});

test('overdue, target reached, missing linked habit, and month boundary are handled', () => {
  const goal = saveGoal([], { ...base, periodStart: '2026-09-29', targetDate: '2026-10-02' }, { habits: [habit] })[0];
  const missing = goalProgress(goal, { habits: [], checksData: { '2026-8': { read: { 29: true, 30: true } }, '2026-9': { read: { 1: true } } }, now: new Date(2026, 9, 17, 12) });
  assert.equal(missing.count, 3);assert.equal(missing.overdue, false);assert.equal(missing.completed, true);
  const overdueGoal = { ...goal, targetCount: 5 };
  const overdue = goalProgress(overdueGoal, { habits: [habit], checksData: {}, now: new Date(2026, 9, 17, 12) });
  assert.equal(overdue.overdue, true);assert.equal(overdue.daysRemaining, -15);
});
