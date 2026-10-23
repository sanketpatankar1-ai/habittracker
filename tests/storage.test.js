import test from 'node:test';
import assert from 'node:assert/strict';
import { createSafeStorage, earliestCheckedDate, exportLocalData, importLocalData, validateImport } from '../src/features/storage/localStorage.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test('existing ht_* data exports and imports without changing its storage schema', () => {
  const old = new MemoryStorage();
  old.setItem('ht_habits', JSON.stringify([{ id: 'h1', title: 'Read' }]));
  old.setItem('ht_checks', JSON.stringify({ '2026-9': { h1: { 17: true } } }));
  const backup = exportLocalData(old);
  const fresh = new MemoryStorage();
  assert.deepEqual(importLocalData(backup, fresh), ['ht_habits', 'ht_checks']);
  assert.equal(fresh.getItem('ht_habits'), old.getItem('ht_habits'));
  assert.equal(JSON.parse(fresh.getItem('ht_checks'))['2026-9'].h1[17], true);
});

test('goals are included in portable backups and validated when restored', () => {
  const source = new MemoryStorage();source.setItem('ht_goals', JSON.stringify([{ id: 'g1', title: 'Read more', type: 'manual' }]));
  const backup = exportLocalData(source), target = new MemoryStorage();
  assert.deepEqual(importLocalData(backup, target), ['ht_goals']);
  assert.deepEqual(JSON.parse(target.getItem('ht_goals')), [{ id: 'g1', title: 'Read more', type: 'manual' }]);
  const invalid = { format: 'habit-tracker-backup', data: { ht_goals: JSON.stringify({ invalid: true }) } };
  assert.throws(() => validateImport(invalid), /wrong format/);
});

test('import refuses to replace populated browser data without an explicit confirmation', () => {
  const storage = new MemoryStorage();
  storage.setItem('ht_habits', JSON.stringify([{ id: 'existing', title: 'Walk' }]));
  const backup = { format: 'habit-tracker-backup', version: 1, data: { ht_habits: JSON.stringify([{ id: 'new', title: 'Read' }]) } };
  assert.throws(() => importLocalData(backup, storage), /Confirm replacement/);
  assert.equal(JSON.parse(storage.getItem('ht_habits'))[0].id, 'existing');
  importLocalData(backup, storage, { allowReplace: true });
  assert.equal(JSON.parse(storage.getItem('ht_habits'))[0].id, 'new');
  assert.ok([...storage.values.keys()].some((key) => key.startsWith('ht_preimport_backup_')));
});

test('invalid backup values are rejected before any data is changed', () => {
  const storage = new MemoryStorage(); storage.setItem('ht_habits', '[]');
  const payload = { format: 'habit-tracker-backup', data: { ht_habits: '{}' } };
  assert.throws(() => validateImport(payload), /wrong format/);
  assert.equal(storage.getItem('ht_habits'), '[]');
});

test('corrupt browser values are preserved and a warning is reported', () => {
  const storage = new MemoryStorage(); storage.setItem('ht_checks', '{broken');
  const warnings = [];
  const { read } = createSafeStorage((message) => warnings.push(message), storage);
  assert.deepEqual(read('ht_checks', {}), {});
  assert.equal(storage.getItem('ht_checks'), '{broken');
  assert.equal(storage.getItem('ht_corrupt_backup_ht_checks'), '{broken');
  assert.equal(warnings.length, 1);
});

test('structurally invalid values can be backed up without overwriting an earlier recovery copy', () => {
  const storage = new MemoryStorage();
  storage.setItem('ht_habits', '[{"id":"bad","title":"Walk","startDate":"not-a-date"}]');
  const { preserveRaw } = createSafeStorage(() => {}, storage);
  assert.equal(preserveRaw('ht_habits'), true);
  const key = 'ht_corrupt_backup_ht_habits';
  const original = storage.getItem(key);
  storage.setItem('ht_habits', '[]');
  assert.equal(preserveRaw('ht_habits'), true);
  assert.equal(storage.getItem(key), original);
});

test('legacy checks find the earliest valid checked date', () => {
  assert.equal(earliestCheckedDate('h1', { '2026-9': { h1: { 17: true, 32: true } }, '2026-8': { h1: { 30: true } } }), '2026-09-30');
});

