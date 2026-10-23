export function createTrackerState(now = new Date()) {
  return {
    year: now.getFullYear(), month: now.getMonth(),
    habits: [], archivedHabits: [], goals: [], checksData: {}, moodData: {}, sleepData: {},
    themeSettings: null, themeDraft: null, themeReturnFocus: null,
    focusMode: false, notes: [],
  };
}

export const trackerState = createTrackerState();

export function selectMonth(state, year, month) {
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 0 || month > 11) return false;
  state.year = year; state.month = month;
  return true;
}
