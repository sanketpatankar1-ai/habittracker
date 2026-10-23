import test from 'node:test';
import assert from 'node:assert/strict';
import { addHabitsToState, editHabitInState, archiveHabitInState, restoreHabitInState, deleteHabitFromState, reorderHabitInState } from '../src/features/habits/management.js';
import { calculateDashboardAnalytics, buildMonthlyReportData, isScheduled, dateFor } from '../src/features/analytics/calculations.js';
import { createTrackerState, selectMonth } from '../src/features/state/trackerState.js';

const stateWith = (...habits) => ({ habits: [...habits], archivedHabits: [], checksData: {} });
const habit = (id, title) => ({ id, title, startDate: '2026-10-01', schedule: [0,1,2,3,4,5,6] });

test('add validates names, normalizes duplicates, and bulk adds unique habits', () => {
  const state = stateWith(habit('a', 'Walk'));
  const result = addHabitsToState(state, [{ id:'b', title:' Read  ' }, { id:'c', title:'walk' }, { id:'d', title:'Read' }, { id:'e', title:'  ' }], '2026-10-17');
  assert.deepEqual(result.added.map((item) => item.title), ['Read']);
  assert.deepEqual(result.duplicates, ['walk', 'Read']);
  assert.equal(state.habits.length, 2);
  assert.deepEqual(state.habits[1].schedule, [0,1,2,3,4,5,6]);
});

test('edit rejects empty and duplicate names and preserves prior schedule rules', () => {
  const state = stateWith(habit('a', 'Walk'), habit('b', 'Read'));
  assert.equal(editHabitInState(state, 'a', { title:'  ', schedule:[1] }, '2026-10-17').ok, false);
  assert.equal(editHabitInState(state, 'a', { title:' read ', schedule:[1] }, '2026-10-17').ok, false);
  const result = editHabitInState(state, 'a', { title:'Morning walk', schedule:['1','3'], emoji:'🚶', category:'health' }, '2026-10-17');
  assert.equal(result.ok, true);
  assert.deepEqual(state.habits[0].schedule, [1,3]);
  assert.deepEqual(state.habits[0].scheduleHistory[0], { startDate:'2026-10-01', endDate:'2026-10-16', schedule:[0,1,2,3,4,5,6] });
  assert.equal(state.habits[0].title, 'Morning walk');
});

test('archive, restore, delete, and reorder preserve unrelated records and prevent duplicate restore', () => {
  const a = habit('a', 'Walk'), b = habit('b', 'Read'), c = habit('c', 'Stretch');
  const state = stateWith(a,b,c); state.checksData['2026-9'] = { a:{3:true}, b:{4:true} };
  assert.equal(reorderHabitInState(state, 'c', -2), true);
  assert.deepEqual(state.habits.map((item) => item.id), ['a','c','b']);
  assert.equal(archiveHabitInState(state, 'a', '2026-10-17'), true);
  assert.equal(restoreHabitInState(state, 'a').ok, true);
  archiveHabitInState(state, 'a', '2026-10-17');
  state.habits.push(habit('another', ' WALK '));
  assert.match(restoreHabitInState(state, 'a').error, /already uses that name/);
  assert.equal(deleteHabitFromState(state, 'b'), true);
  assert.equal(state.checksData['2026-9'].b[4], true);
  assert.deepEqual(state.habits.map((item) => item.id), ['c','another']);
});

test('restoring keeps archived dates out of new active analytics while retaining logs', () => {
  const state = stateWith();
  state.archivedHabits.push({ ...habit('a','Walk'), archivedAt:'2026-10-10' });
  state.checksData['2026-9']={a:{10:true,12:true,20:true}};
  assert.equal(restoreHabitInState(state,'a','2026-10-20').ok,true);
  const report=buildMonthlyReportData({habits:state.habits,archivedHabits:[],checksData:state.checksData,moodData:{},sleepData:{},year:2026,month:9,now:new Date(2026,9,21,12)});
  assert.equal(report.rows[0].goal,12);
  assert.equal(report.rows[0].done,2);
  assert.equal(state.checksData['2026-9'].a[12],true);
});

test('daily and selected weekdays/rest days use the schedule shared with analytics', () => {
  const scheduled = { ...habit('a','Run'), schedule:[1,3,5] };
  assert.equal(isScheduled(scheduled, dateFor(2026,9,5)), true); // Monday
  assert.equal(isScheduled(scheduled, dateFor(2026,9,6)), false); // Tuesday rest day
  const result = calculateDashboardAnalytics({ habits:[scheduled], checksData:{'2026-9':{a:{5:true}}}, year:2026, month:9, now:new Date(2026,9,7,12) });
  assert.equal(result.monthGoal, 13);
  assert.equal(result.habitStats[0].actual, 1);
});

test('schedule history keeps old month analytics after schedule edits', () => {
  const state = stateWith(habit('a','Run'));
  editHabitInState(state, 'a', { title:'Run', schedule:[1] }, '2026-10-17');
  const result = calculateDashboardAnalytics({ habits:state.habits, checksData:{'2026-9':{a:{1:true,2:true,3:true,4:true}}}, year:2026, month:9, now:new Date(2026,9,17,12) });
  assert.equal(result.monthGoal, 18); // 16 historical daily goals plus two future Mondays under the new schedule.
  assert.equal(result.habitStats[0].goal, 16);
  assert.equal(result.done, 4);
  assert.equal(isScheduled(state.habits[0], dateFor(2026,9,1)), true);
  assert.equal(isScheduled(state.habits[0], dateFor(2026,9,20)), false);
});

test('current and best streaks skip rest days, ignore future marks, and break on missing scheduled days', () => {
  const h = { ...habit('a','Run'), schedule:[1,3,5] };
  const logs = { '2026-9':{a:{12:true,14:true,16:true,19:true}} };
  const result = calculateDashboardAnalytics({ habits:[h], checksData:logs, year:2026, month:9, now:new Date(2026,9,17,12) });
  assert.equal(result.habitStats[0].currentStreak, 3);
  assert.equal(result.habitStats[0].bestStreak, 3);
  const incomplete = calculateDashboardAnalytics({ habits:[h], checksData:{'2026-9':{a:{12:true,14:true,16:false,19:true}}}, year:2026, month:9, now:new Date(2026,9,17,12) });
  assert.equal(incomplete.habitStats[0].currentStreak, 0);
  assert.equal(incomplete.habitStats[0].bestStreak, 2);
});

test('month navigation crosses year boundaries and preserves leap-month records', () => {
  const state = createTrackerState(new Date(2026,11,1)); state.checksData['2026-11']={a:{31:true}};
  assert.equal(selectMonth(state,2027,0), true); assert.deepEqual([state.year,state.month],[2027,0]);
  assert.equal(selectMonth(state,2026,1), true); assert.deepEqual([state.year,state.month],[2026,1]);
  assert.equal(state.checksData['2026-11'].a[31], true);
  assert.equal(calculateDashboardAnalytics({habits:[{...habit('a','Read'),startDate:'2024-02-01'}],checksData:{},year:2024,month:1,now:new Date(2024,1,29,12)}).monthGoal,29);
});

test('localStorage persistence round-trips management metadata and completion history', () => {
  const state=stateWith(habit('a','Walk'));state.checksData['2026-9']={a:{16:true}};
  editHabitInState(state,'a',{title:'Evening walk',schedule:[2,4]},'2026-10-17');
  const storage=new Map();storage.set('ht_habits',JSON.stringify(state.habits));storage.set('ht_checks',JSON.stringify(state.checksData));
  const afterRefresh={habits:JSON.parse(storage.get('ht_habits')),checksData:JSON.parse(storage.get('ht_checks'))};
  assert.equal(afterRefresh.habits[0].title,'Evening walk');
  assert.equal(afterRefresh.habits[0].scheduleHistory.length,1);
  assert.equal(afterRefresh.checksData['2026-9'].a[16],true);
  assert.equal(isScheduled(afterRefresh.habits[0],dateFor(2026,9,16)),true);
});
