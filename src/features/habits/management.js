import { isValidLocalDate } from '../analytics/calculations.js';

export const normalizeHabitName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function addHabitsToState(state, habits, startDate) {
  const existing = new Set(state.habits.map((habit) => normalizeHabitName(habit.title)));
  const added = [], duplicates = [];
  for (const source of habits) {
    const title = String(source?.title ?? '').trim().replace(/\s+/g, ' ');
    if (!title) continue;
    const key = normalizeHabitName(title);
    if (existing.has(key)) { duplicates.push(title); continue; }
    const habit = { ...source, title, startDate, schedule: [0, 1, 2, 3, 4, 5, 6] };
    state.habits.push(habit); existing.add(key); added.push(habit);
  }
  return { added, duplicates };
}

export function editHabitInState(state, id, updates, today) {
  const habit = state.habits.find((item) => item.id === id);
  if (!habit) return { ok: false, error: 'Habit not found.' };
  const title = String(updates.title ?? '').trim().replace(/\s+/g, ' ');
  if (!title) return { ok: false, error: 'Habit name cannot be empty.' };
  const name = normalizeHabitName(title);
  if (state.habits.some((item) => item.id !== id && normalizeHabitName(item.title) === name)) return { ok: false, error: 'A habit with that name already exists.' };
  const rawSchedule = Array.isArray(updates.schedule) ? updates.schedule.map(Number) : [];
  if (rawSchedule.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return { ok: false, error: 'Weekdays must be numbers from 0 (Sunday) to 6 (Saturday).' };
  const schedule = [...new Set(rawSchedule)].sort();
  if (!schedule.length) return { ok: false, error: 'Choose at least one scheduled weekday. Use unchecked weekdays as rest days.' };
  if (!isValidLocalDate(today)) return { ok: false, error: 'The current date is invalid.' };
  const oldSchedule = Array.isArray(habit.schedule) ? [...habit.schedule] : [0, 1, 2, 3, 4, 5, 6];
  if (oldSchedule.join(',') !== schedule.join(',')) {
    const previousStart = isValidLocalDate(habit.scheduleStartDate) ? habit.scheduleStartDate : (isValidLocalDate(habit.startDate) ? habit.startDate : '0001-01-01');
    const yesterday = new Date(`${today}T12:00:00`); yesterday.setDate(yesterday.getDate() - 1);
    const endDate = `${yesterday.getFullYear().toString().padStart(4, '0')}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    habit.scheduleHistory = Array.isArray(habit.scheduleHistory) ? habit.scheduleHistory : [];
    if (previousStart <= endDate) habit.scheduleHistory.push({ startDate: previousStart, endDate, schedule: oldSchedule });
    habit.scheduleStartDate = today;
  }
  habit.title = title;
  habit.schedule = schedule;
  habit.emoji = String(updates.emoji || '').trim() || '📌';
  habit.category = String(updates.category || '').trim();
  return { ok: true, habit };
}

export function archiveHabitInState(state, id, archivedAt) {
  const index = state.habits.findIndex((habit) => habit.id === id);
  if (index < 0) return false;
  const [habit] = state.habits.splice(index, 1);
  state.archivedHabits.push({ ...habit, archivedAt });
  return true;
}

export function restoreHabitInState(state, id, today) {
  const index = state.archivedHabits.findIndex((habit) => habit.id === id);
  if (index < 0) return { ok: false, error: 'Archived habit not found.' };
  const habit = state.archivedHabits[index];
  if (state.habits.some((item) => normalizeHabitName(item.title) === normalizeHabitName(habit.title))) return { ok: false, error: 'An active habit already uses that name. Rename it before restoring this habit.' };
  state.archivedHabits.splice(index, 1);
  const restored = { ...habit };
  if (isValidLocalDate(restored.archivedAt) && isValidLocalDate(today)) {
    const dayAfterArchive = new Date(`${restored.archivedAt}T12:00:00`); dayAfterArchive.setDate(dayAfterArchive.getDate() + 1);
    const yesterday = new Date(`${today}T12:00:00`); yesterday.setDate(yesterday.getDate() - 1);
    if (dayAfterArchive <= yesterday) {
      const iso = (date) => `${date.getFullYear().toString().padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      restored.inactivePeriods = Array.isArray(restored.inactivePeriods) ? restored.inactivePeriods : [];
      restored.inactivePeriods.push({ startDate: iso(dayAfterArchive), endDate: iso(yesterday) });
    }
  }
  delete restored.archivedAt;
  state.habits.push(restored);
  return { ok: true, habit: restored };
}

export function deleteHabitFromState(state, id) {
  const index = state.habits.findIndex((habit) => habit.id === id);
  if (index < 0) return false;
  state.habits.splice(index, 1);
  // Completion logs are keyed by habit id and intentionally retained for recovery/history.
  return true;
}

export function reorderHabitInState(state, id, delta) {
  const index = state.habits.findIndex((habit) => habit.id === id);
  const destination = index + Math.sign(delta);
  if (index < 0 || destination < 0 || destination >= state.habits.length) return false;
  [state.habits[index], state.habits[destination]] = [state.habits[destination], state.habits[index]];
  return true;
}
