import { isHabitEligibleOnDate, isValidLocalDate, localISO } from '../analytics/calculations.js';

function dateFromISO(iso) {
  const [year, month, day] = iso.split('-').map(Number), date = new Date(0);
  date.setFullYear(year, month - 1, day);date.setHours(12, 0, 0, 0);return date;
}

function dayOrdinal(iso) {
  const [year, month, day] = iso.split('-').map(Number), date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);date.setUTCFullYear(year, month - 1, day);return Math.floor(date.getTime() / 86400000);
}

export function validateGoal(input, { habits = [] } = {}) {
  const title = String(input?.title || '').trim();
  if (!title || title.length > 80) throw new Error('Enter a goal title between 1 and 80 characters.');
  if (input?.description && String(input.description).length > 240) throw new Error('Keep the description under 240 characters.');
  if (!isValidLocalDate(input?.targetDate)) throw new Error('Choose a valid target date.');
  if (input.type === 'habit') {
    const habit = habits.find((item) => item.id === input.habitId);
    if (!habit) throw new Error('Choose an existing habit for this goal.');
    if (!isValidLocalDate(input.periodStart) || input.periodStart > input.targetDate) throw new Error('Choose a valid start date on or before the deadline.');
    if (!Number.isInteger(Number(input.targetCount)) || Number(input.targetCount) < 1 || Number(input.targetCount) > 10000) throw new Error('Set a completion target from 1 to 10,000.');
    return { title, description: String(input.description || '').trim(), type: 'habit', targetDate: input.targetDate, periodStart: input.periodStart, habitId: habit.id, habitTitle: habit.title, targetCount: Number(input.targetCount), manualProgress: 0 };
  }
  if (input.type !== 'manual') throw new Error('Choose a progress method.');
  if (!Number.isInteger(Number(input.targetCount)) || Number(input.targetCount) < 1 || Number(input.targetCount) > 10000) throw new Error('Set a measurable milestone target from 1 to 10,000.');
  const manualProgress = Number(input.manualProgress);
  if (!Number.isInteger(manualProgress) || manualProgress < 0 || manualProgress > Number(input.targetCount)) throw new Error('Progress must be a whole number between zero and the target.');
  return { title, description: String(input.description || '').trim(), type: 'manual', targetDate: input.targetDate, targetCount: Number(input.targetCount), manualProgress };
}

export function saveGoal(goals, input, options = {}) {
  const data = validateGoal(input, options);
  const id = input.id || (globalThis.crypto?.randomUUID?.() ?? `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const existing = goals.find((goal) => goal.id === id);
  const next = { id, ...data, status: existing?.status || 'active', isActive: existing ? existing.status === 'completed' ? false : existing.isActive : goals.every((goal) => !goal.isActive), createdAt: existing?.createdAt || new Date().toISOString() };
  return existing ? goals.map((goal) => goal.id === id ? next : goal) : [...goals, next];
}

export function goalProgress(goal, { habits = [], checksData = {}, now = new Date() } = {}) {
  const todayISO = localISO(now), today = dateFromISO(todayISO);
  let count = 0;
  if (goal.type === 'manual') count = Number(goal.manualProgress) || 0;
  else {
    const habit = habits.find((item) => item.id === goal.habitId);
    const start = goal.periodStart, end = todayISO < goal.targetDate ? todayISO : goal.targetDate;
    if (isValidLocalDate(start) && start <= end) for (const [monthKey, monthData] of Object.entries(checksData || {})) {
      const match = /^(\d{1,4})-(\d{1,2})$/.exec(monthKey), year = Number(match?.[1]), month = Number(match?.[2]);
      const checks = match && month >= 0 && month <= 11 ? monthData?.[goal.habitId] : null;
      if (!checks || typeof checks !== 'object' || Array.isArray(checks)) continue;
      for (const [rawDay, checked] of Object.entries(checks)) {
        const day = Number(rawDay);
        if (checked !== true || !Number.isInteger(day) || day < 1 || day > 31) continue;
        const iso = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (!isValidLocalDate(iso) || iso < start || iso > end) continue;
        const date = dateFromISO(iso);
        if (!habit || isHabitEligibleOnDate(habit, date)) count++;
      }
    }
  }
  const target = Math.max(1, Number(goal.targetCount) || 1), progress = Math.min(target, Math.max(0, count));
  const daysRemaining = dayOrdinal(goal.targetDate) - dayOrdinal(todayISO);
  return { count: progress, target, percent: Math.round(progress / target * 100), overdue: daysRemaining < 0 && progress < target, completed: goal.status === 'completed' || progress >= target, daysRemaining };
}

export function setGoalActive(goals, id) {
  if (!goals.some((goal) => goal.id === id && goal.status !== 'completed')) return goals;
  return goals.map((goal) => ({ ...goal, isActive: goal.id === id }));
}

export function setGoalCompleted(goals, id, completed = true) {
  const next = goals.map((goal) => goal.id === id ? { ...goal, status: completed ? 'completed' : 'active', isActive: completed ? false : goal.isActive } : goal);
  if (!next.some((goal) => goal.isActive && goal.status !== 'completed')) {
    const replacement = next.find((goal) => goal.status !== 'completed');
    if (replacement) return next.map((goal) => ({ ...goal, isActive: goal.id === replacement.id }));
  }
  return next;
}

export function deleteGoal(goals, id) {
  const remaining = goals.filter((goal) => goal.id !== id);
  if (!remaining.some((goal) => goal.isActive)) {
    const next = remaining.find((goal) => goal.status !== 'completed');
    if (next) return remaining.map((goal) => ({ ...goal, isActive: goal.id === next.id }));
  }
  return remaining;
}
