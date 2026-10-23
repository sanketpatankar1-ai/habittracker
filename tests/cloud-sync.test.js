import test from 'node:test';
import assert from 'node:assert/strict';
import { accountCacheKey, cacheTrackerSnapshot, mergeTrackerSnapshots, preserveTrackerSnapshot, readAccountCache, readTrackerSnapshot, trackerSnapshotHasData, writeTrackerSnapshot } from '../src/features/cloud/trackerSync.js';
import { calculateDashboardAnalytics } from '../src/features/analytics/calculations.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test('snapshot migration preserves historical date strings and all original tracker preferences', () => {
  const storage = new MemoryStorage();
  const snapshot = { habits: [{ id: 'walk', title: 'Walk', startDate: '2024-02-29', schedule: [4] }], archivedHabits: [{ id: 'old', title: 'Old' }], checksData: { '2024-1': { walk: { 29: true } } }, moodData: { '2024-1': { 29: 4 } }, sleepData: { '2024-1': { 29: 8 } }, notes: [{ id: 'n', text: 'Note' }], theme: 'light', themeSettings: { preset: 'sage' }, focusMode: true };
  writeTrackerSnapshot(snapshot, storage);
  assert.deepEqual(readTrackerSnapshot(storage), { ...snapshot, goals: [], schemaVersion: 2 });
  assert.ok(trackerSnapshotHasData(snapshot));
});

test('goals round-trip through local storage and merge by stable ID in cloud snapshots', () => {
  const storage = new MemoryStorage(), local = { goals: [{ id: 'g1', title: 'Local edit' }, { id: 'g2', title: 'Guest goal' }] };
  const cloud = { goals: [{ id: 'g1', title: 'Cloud version' }] };
  const merged = mergeTrackerSnapshots(local, cloud);
  assert.deepEqual(merged.goals, [{ id: 'g1', title: 'Cloud version' }, { id: 'g2', title: 'Guest goal' }]);
  writeTrackerSnapshot(merged, storage);
  assert.deepEqual(readTrackerSnapshot(storage).goals, merged.goals);
  assert.equal(trackerSnapshotHasData({ goals: [merged.goals[0]] }), true);
});

test('migration merges by stable IDs, keeps completion truth, prefers cloud conflicts, and deduplicates records', () => {
  const local = { habits: [{ id: 'a', title: 'Local rename' }, { id: 'b', title: 'Local only' }], checksData: { '2026-9': { a: { 1: true, 2: false }, b: { 3: true } } }, moodData: { '2026-9': { 1: 2, 2: 4 } }, notes: [{ id: 'same', text: 'old' }, { id: 'local', text: 'keep' }], theme: 'light' };
  const cloud = { habits: [{ id: 'a', title: 'Cloud version' }], checksData: { '2026-9': { a: { 1: false, 2: true } } }, moodData: { '2026-9': { 1: 5 } }, notes: [{ id: 'same', text: 'cloud' }], theme: 'dark' };
  const merged = mergeTrackerSnapshots(local, cloud);
  assert.deepEqual(merged.habits, [{ id: 'a', title: 'Cloud version' }, { id: 'b', title: 'Local only' }]);
  assert.deepEqual(merged.checksData['2026-9'].a, { 1: true, 2: true });
  assert.equal(merged.checksData['2026-9'].b[3], true);
  assert.deepEqual(merged.moodData['2026-9'], { 1: 5, 2: 4 });
  assert.deepEqual(merged.notes.map((note) => note.id), ['same', 'local']);
  assert.equal(merged.theme, 'light', 'local preference fills an absent cloud theme settings record');
  assert.equal(local.checksData['2026-9'].a[2], false, 'merge does not mutate the local snapshot');
});

test('account cache is namespaced, independent, and guest recovery backups never overwrite', () => {
  const storage = new MemoryStorage(), first = { habits: [{ id: 'a', title: 'A' }] }, second = { habits: [{ id: 'b', title: 'B' }] };
  assert.notEqual(accountCacheKey('user one'), accountCacheKey('user_two'));
  cacheTrackerSnapshot('user one', first, storage);cacheTrackerSnapshot('user_two', second, storage);
  assert.equal(readAccountCache('user one', storage).habits[0].id, 'a');
  assert.equal(readAccountCache('user_two', storage).habits[0].id, 'b');
  storage.setItem('ht_habits', JSON.stringify(first.habits));
  const backup1 = preserveTrackerSnapshot(storage, 100), backup2 = preserveTrackerSnapshot(storage, 100);
  assert.notEqual(backup1, backup2);
  assert.deepEqual(JSON.parse(storage.getItem(backup1)).ht_habits, JSON.stringify(first.habits));
});

test('default theme initialization alone does not trigger a misleading local-data import prompt', () => {
  assert.equal(trackerSnapshotHasData({ themeSettings: { preset: 'midnight', appearance: 'dark', accent: '#d9dee8', background: '#080a0f', surface: '#11151c', density: 'comfortable' } }), false);
  assert.equal(trackerSnapshotHasData({ themeSettings: { preset: 'sage', appearance: 'light' } }), true);
});

test('migration round-trip preserves the analytics snapshot from source habit records', () => {
  const local = { habits: [{ id: 'walk', title: 'Walk', schedule: [1, 2, 3, 4, 5], startDate: '2026-10-01' }], checksData: { '2026-9': { walk: { 1: true, 2: false, 5: true, 9: true } } }, moodData: { '2026-9': { 1: 4 } }, sleepData: { '2026-9': { 1: 7 } } };
  const cloud = { habits: [{ id: 'read', title: 'Read', schedule: [0, 6], startDate: '2026-10-01' }], checksData: { '2026-9': { read: { 3: true } } } };
  const merged = mergeTrackerSnapshots(local, cloud),storage=new MemoryStorage();writeTrackerSnapshot(merged,storage);
  const after=readTrackerSnapshot(storage),run=(snapshot)=>calculateDashboardAnalytics({habits:snapshot.habits,checksData:snapshot.checksData,sleepData:snapshot.sleepData,year:2026,month:9,now:new Date(2026,9,17,12)});
  assert.deepEqual(run(after),run(merged));
});
