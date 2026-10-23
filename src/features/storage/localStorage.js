export function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function createSafeStorage(onWarning = () => {}, storage = localStorage) {
  function preserveRaw(key) {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return false;
      const backupKey = `ht_corrupt_backup_${key}`;
      if (storage.getItem(backupKey) === null) storage.setItem(backupKey, raw);
      return true;
    } catch { return false; }
  }

  function read(key, fallback) {
    let raw;
    try {
      raw = storage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch {
      if (raw !== undefined && raw !== null) preserveRaw(key);
      onWarning(`Could not read saved ${key.replace(/^ht_/, '')} data. Its original contents were preserved where browser storage allowed.`);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      onWarning(`Could not save changes (${error.name || 'storage error'}). Free browser storage space and try again.`);
      return false;
    }
  }

  return { read, write, preserveRaw };
}

export function earliestCheckedDate(id, checksData) {
  let first = null;
  for (const [key, monthData] of Object.entries(checksData || {})) {
    const match = /^(\d{1,4})-(\d{1,2})$/.exec(key);
    const year = match ? Number(match[1]) : NaN, month = match ? Number(match[2]) : NaN;
    const checks = monthData?.[id];
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11 || !isPlainObject(checks)) continue;
    for (const [rawDay, checked] of Object.entries(checks)) {
      const day = Number(rawDay);
      if (checked !== true || !Number.isInteger(day) || day < 1) continue;
      const date = new Date(year, month, day, 12);
      if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) continue;
      const iso = `${year.toString().padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (!first || iso < first) first = iso;
    }
  }
  return first;
}

const DATA_KEYS = ['ht_habits', 'ht_archived', 'ht_goals', 'ht_checks', 'ht_mood', 'ht_sleep', 'ht_notes', 'ht_theme', 'ht_theme_settings', 'ht_focus_mode', 'ht_schema_version'];

export function exportLocalData(storage = localStorage) {
  const data = Object.fromEntries(DATA_KEYS.map((key) => [key, storage.getItem(key)]).filter(([, value]) => value !== null));
  return { format: 'habit-tracker-backup', version: 1, exportedAt: new Date().toISOString(), data };
}

export function validateImport(payload) {
  if (!isPlainObject(payload) || payload.format !== 'habit-tracker-backup' || !isPlainObject(payload.data)) {
    throw new Error('This file is not a Habit Tracker data backup.');
  }
  const entries = Object.entries(payload.data).filter(([key]) => DATA_KEYS.includes(key));
  if (!entries.length) throw new Error('The backup does not contain Habit Tracker data.');
  for (const [key, raw] of entries) {
    if (typeof raw !== 'string') throw new Error(`The backup value for ${key} is invalid.`);
    const value = JSON.parse(raw);
    const expected = {
      ht_habits: Array.isArray, ht_archived: Array.isArray, ht_goals: Array.isArray, ht_checks: isPlainObject,
      ht_mood: isPlainObject, ht_sleep: isPlainObject, ht_notes: Array.isArray,
      ht_theme: (item) => item === 'light' || item === 'dark',
      ht_theme_settings: isPlainObject, ht_focus_mode: (item) => typeof item === 'boolean',
      ht_schema_version: (item) => Number.isInteger(item) && item >= 1,
    }[key];
    if (expected && !expected(value)) throw new Error(`The backup value for ${key} has the wrong format.`);
    if (['ht_checks', 'ht_mood', 'ht_sleep'].includes(key)
      && Object.values(value).some((month) => !isPlainObject(month))) {
      throw new Error(`The backup value for ${key} has invalid month data.`);
    }
  }
  return Object.fromEntries(entries);
}

export function importLocalData(payload, storage = localStorage, { allowReplace = false } = {}) {
  const values = validateImport(payload);
  const previous = Object.fromEntries(DATA_KEYS.map((key) => [key, storage.getItem(key)]).filter(([, value]) => value !== null));
  const userDataKeys = ['ht_habits', 'ht_archived', 'ht_goals', 'ht_checks', 'ht_mood', 'ht_sleep', 'ht_notes'];
  const hasUserData = userDataKeys.some((key) => {
    const raw = previous[key]; if (raw == null) return false;
    const value = JSON.parse(raw);
    return Array.isArray(value) || isPlainObject(value) ? Object.keys(value).length > 0 : !!value;
  });
  if (hasUserData && !allowReplace) throw new Error('This browser already has habit data. Confirm replacement to import this backup.');
  const backupBase = `ht_preimport_backup_${Date.now()}`;
  let backupKey = backupBase, backupSuffix = 1;
  while (storage.getItem(backupKey) !== null) backupKey = `${backupBase}_${backupSuffix++}`;
  if (Object.keys(previous).length) storage.setItem(backupKey, JSON.stringify(previous));
  const touched = new Set();
  try {
    for (const [key, raw] of Object.entries(values)) { touched.add(key); storage.setItem(key, raw); }
  } catch (error) {
    for (const key of touched) {
      try {
        if (Object.hasOwn(previous, key)) storage.setItem(key, previous[key]);
        else storage.removeItem(key);
      } catch { /* A full storage area may prevent rollback; the pre-import snapshot remains available. */ }
    }
    throw error;
  }
  return Object.keys(values);
}
