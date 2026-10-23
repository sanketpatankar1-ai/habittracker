const STORAGE_KEYS = {
  habits: 'ht_habits', archivedHabits: 'ht_archived', goals: 'ht_goals', checksData: 'ht_checks', moodData: 'ht_mood',
  sleepData: 'ht_sleep', notes: 'ht_notes', theme: 'ht_theme', themeSettings: 'ht_theme_settings', focusMode: 'ht_focus_mode', schemaVersion: 'ht_schema_version',
};

const defaults = { habits: [], archivedHabits: [], goals: [], checksData: {}, moodData: {}, sleepData: {}, notes: [], theme: 'dark', themeSettings: null, focusMode: false, schemaVersion: 2 };

function parse(raw, fallback) { try { return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } }

export function readTrackerSnapshot(storage = localStorage) {
  return Object.fromEntries(Object.entries(STORAGE_KEYS).map(([field, key]) => [field, parse(storage.getItem(key), defaults[field])]));
}

export function normalizeTrackerSnapshot(value = {}) {
  const snapshot = { ...defaults, ...(value && typeof value === 'object' ? value : {}) };
  for (const key of ['habits', 'archivedHabits', 'goals', 'notes']) if (!Array.isArray(snapshot[key])) snapshot[key] = [];
  for (const key of ['checksData', 'moodData', 'sleepData']) if (!snapshot[key] || typeof snapshot[key] !== 'object' || Array.isArray(snapshot[key])) snapshot[key] = {};
  if (!['light', 'dark'].includes(snapshot.theme)) snapshot.theme = 'dark';
  if (snapshot.themeSettings !== null && (typeof snapshot.themeSettings !== 'object' || Array.isArray(snapshot.themeSettings))) snapshot.themeSettings = null;
  snapshot.focusMode = snapshot.focusMode === true;
  snapshot.schemaVersion = 2;
  return snapshot;
}

export function trackerSnapshotHasData(input) {
  const data = normalizeTrackerSnapshot(input);
  const theme = data.themeSettings;
  const hasCustomTheme = theme && (theme.preset !== 'midnight' || theme.appearance !== 'dark' || theme.density !== 'comfortable' || theme.accent?.toLowerCase() !== '#d9dee8' || theme.background?.toLowerCase() !== '#080a0f' || theme.surface?.toLowerCase() !== '#11151c');
  return !!(data.habits.length || data.archivedHabits.length || data.goals.length || data.notes.length
    || Object.keys(data.checksData).length || Object.keys(data.moodData).length || Object.keys(data.sleepData).length
    || hasCustomTheme || data.theme !== 'dark' || data.focusMode);
}

function mergeCalendarData(local = {}, cloud = {}, { completions = false } = {}) {
  const result = structuredClone(cloud || {});
  for (const [month, localDays] of Object.entries(local || {})) {
    if (!result[month] || typeof result[month] !== 'object') result[month] = {};
    for (const [recordId, localValues] of Object.entries(localDays || {})) {
      if (!result[month][recordId] || typeof result[month][recordId] !== 'object') result[month][recordId] = {};
      for (const [day, localValue] of Object.entries(localValues || {})) {
        const cloudHasValue = Object.hasOwn(result[month][recordId], day);
        if (!cloudHasValue) result[month][recordId][day] = localValue;
        else if (completions && (result[month][recordId][day] === true || localValue === true)) result[month][recordId][day] = true;
      }
    }
  }
  return result;
}

function mergeWellbeingData(local = {}, cloud = {}) {
  const result = structuredClone(cloud || {});
  for (const [month, entries] of Object.entries(local || {})) {
    if (!result[month] || typeof result[month] !== 'object') result[month] = {};
    for (const [day, value] of Object.entries(entries || {})) if (!Object.hasOwn(result[month], day)) result[month][day] = value;
  }
  return result;
}

/** Cloud values win habit/settings conflicts; date records merge without shifting local date-only keys. */
export function mergeTrackerSnapshots(localInput, cloudInput) {
  const local = normalizeTrackerSnapshot(localInput), cloud = normalizeTrackerSnapshot(cloudInput);
  const habitsById = new Map(cloud.habits.map((habit) => [habit.id, habit]));
  for (const habit of local.habits) if (!habitsById.has(habit.id)) habitsById.set(habit.id, habit);
  const archivedById = new Map(cloud.archivedHabits.map((habit) => [habit.id, habit]));
  for (const habit of local.archivedHabits) if (!archivedById.has(habit.id)) archivedById.set(habit.id, habit);
  const notesById = new Map(cloud.notes.filter((note) => note?.id).map((note) => [note.id, note]));
  for (const note of local.notes) if (!note?.id || !notesById.has(note.id)) notesById.set(note?.id || `local-${notesById.size}`, note);
  const goalsById = new Map(cloud.goals.filter((goal) => goal?.id).map((goal) => [goal.id, goal]));
  for (const goal of local.goals) if (!goal?.id || !goalsById.has(goal.id)) goalsById.set(goal?.id || `local-${goalsById.size}`, goal);
  return {
    ...cloud, goals: [...goalsById.values()],
    habits: [...habitsById.values()], archivedHabits: [...archivedById.values()], notes: [...notesById.values()],
    checksData: mergeCalendarData(local.checksData, cloud.checksData, { completions: true }),
    moodData: mergeWellbeingData(local.moodData, cloud.moodData), sleepData: mergeWellbeingData(local.sleepData, cloud.sleepData),
    theme: cloud.themeSettings || cloud.theme !== 'dark' ? cloud.theme : local.theme,
    themeSettings: cloud.themeSettings || local.themeSettings, focusMode: cloud.focusMode || local.focusMode,
  };
}

export function writeTrackerSnapshot(snapshotInput, storage = localStorage) {
  const snapshot = normalizeTrackerSnapshot(snapshotInput);
  for (const [field, key] of Object.entries(STORAGE_KEYS)) storage.setItem(key, JSON.stringify(snapshot[field]));
  return snapshot;
}

/** Keep a non-overwriting browser recovery copy before guest data is migrated or replaced. */
export function preserveTrackerSnapshot(storage = localStorage, now = Date.now()) {
  const raw = Object.fromEntries(Object.values(STORAGE_KEYS).map((key) => [key, storage.getItem(key)]).filter(([, value]) => value !== null));
  if (!Object.keys(raw).length) return null;
  const base = `ht_precloud_migration_${now}`;
  let backupKey = base, suffix = 1;
  while (storage.getItem(backupKey) !== null) backupKey = `${base}_${suffix++}`;
  storage.setItem(backupKey, JSON.stringify(raw));
  return backupKey;
}

export function accountCacheKey(userId) { return `ht_cloud_cache_${String(userId).replace(/[^a-zA-Z0-9_-]/g, '_')}`; }

export function cacheTrackerSnapshot(userId, snapshot, storage = localStorage) {
  storage.setItem(accountCacheKey(userId), JSON.stringify(normalizeTrackerSnapshot(snapshot)));
}

export function readAccountCache(userId, storage = localStorage) {
  return normalizeTrackerSnapshot(parse(storage.getItem(accountCacheKey(userId)), {}));
}
