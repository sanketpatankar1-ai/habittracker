import { dateFor, getMonthKey, isHabitEligibleOnDate } from './calculations.js';

const dayWindow = (today, daysBack) => {
  const end = dateFor(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end); start.setDate(start.getDate() - daysBack + 1);
  return { start, end };
};

function scheduledSample(habit, checksData, start, end) {
  let eligible = 0, done = 0;
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    if (!isHabitEligibleOnDate(habit, date)) continue;
    eligible++;
    if (checksData?.[getMonthKey(date.getFullYear(), date.getMonth())]?.[habit.id]?.[date.getDate()] === true) done++;
  }
  return { eligible, done, rate: eligible ? done / eligible : null };
}

export function selectSmartInsight({ habits = [], checksData = {}, sleepData = {}, now = new Date() } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  const today = dateFor(now.getFullYear(), now.getMonth(), now.getDate());
  const { start: trendStart, end: trendEnd } = dayWindow(today, 28);
  const midpoint = new Date(trendStart); midpoint.setDate(midpoint.getDate() + 13);
  let trend = null;
  for (const habit of habits) {
    if (!habit?.id || !habit.title) continue;
    const previous = scheduledSample(habit, checksData, trendStart, midpoint);
    const recentStart = new Date(midpoint); recentStart.setDate(recentStart.getDate() + 1);
    const recent = scheduledSample(habit, checksData, recentStart, trendEnd);
    if (previous.eligible < 5 || recent.eligible < 5) continue;
    const change = recent.rate - previous.rate;
    if (Math.abs(change) < .2) continue;
    if (!trend || Math.abs(change) > Math.abs(trend.change)) trend = { habit, change, previous, recent };
  }
  if (trend) return {
    kind: trend.change < 0 ? 'decline' : 'improvement',
    text: `${trend.habit.title} ${trend.change < 0 ? 'is down' : 'is up'} ${Math.round(Math.abs(trend.change) * 100)} points versus the previous 14 days (${trend.previous.done}/${trend.previous.eligible} to ${trend.recent.done}/${trend.recent.eligible}).`,
  };

  const consistency = habits.map((habit) => ({ habit, sample: scheduledSample(habit, checksData, trendStart, today) }))
    .filter(({ habit, sample }) => habit?.title && sample.eligible >= 7 && sample.done > 0)
    .sort((a, b) => b.sample.rate - a.sample.rate);
  if (consistency.length && (consistency.length === 1 || consistency[0].sample.rate - consistency[1].sample.rate >= .05)) {
    const { habit, sample } = consistency[0];
    return { kind: 'consistency', text: `${habit.title} is your most consistent habit in the last 28 days: ${sample.done}/${sample.eligible} scheduled days (${Math.round(sample.rate * 100)}%).` };
  }

  const weekday = Array.from({ length: 7 }, () => ({ done: 0, eligible: 0 }));
  for (const date = new Date(trendStart); date <= today; date.setDate(date.getDate() + 1)) {
    let eligible = 0, done = 0;
    for (const habit of habits) {
      if (!habit?.id || !isHabitEligibleOnDate(habit, date)) continue;
      eligible++;
      if (checksData?.[getMonthKey(date.getFullYear(), date.getMonth())]?.[habit.id]?.[date.getDate()] === true) done++;
    }
    if (eligible) { weekday[date.getDay()].eligible++; weekday[date.getDay()].done += done / eligible; }
  }
  const weekdayRates = weekday.map((day, index) => ({ ...day, index, rate: day.eligible ? day.done / day.eligible : -1 }))
    .filter((day) => day.eligible >= 3).sort((a, b) => b.rate - a.rate);
  if (weekdayRates.length >= 2 && weekdayRates[0].rate - weekdayRates[1].rate >= .15) {
    const name = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(dateFor(2026, 0, weekdayRates[0].index + 4));
    return { kind: 'weekday', text: `${name} has your strongest completion rate over the last four weeks (${Math.round(weekdayRates[0].rate * 100)}% across ${weekdayRates[0].eligible} eligible days).` };
  }

  const rested = [], shorter = [];
  for (const date = new Date(trendStart); date <= today; date.setDate(date.getDate() + 1)) {
    const raw = sleepData?.[getMonthKey(date.getFullYear(), date.getMonth())]?.[date.getDate()];
    if (raw === '' || raw == null || !Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > 24) continue;
    let eligible = 0, done = 0;
    for (const habit of habits) {
      if (!habit?.id || !isHabitEligibleOnDate(habit, date)) continue;
      eligible++;
      if (checksData?.[getMonthKey(date.getFullYear(), date.getMonth())]?.[habit.id]?.[date.getDate()] === true) done++;
    }
    if (eligible) (Number(raw) >= 7 ? rested : shorter).push(done / eligible);
  }
  if (rested.length >= 3 && shorter.length >= 3) {
    const restedRate = rested.reduce((sum, value) => sum + value, 0) / rested.length;
    const shorterRate = shorter.reduce((sum, value) => sum + value, 0) / shorter.length;
    if (Math.abs(restedRate - shorterRate) >= .15) return {
      kind: 'sleep',
      text: `Completion averaged ${Math.round(restedRate * 100)}% after 7+ hours of sleep versus ${Math.round(shorterRate * 100)}% after shorter sleep. This is an association, not evidence of cause (${rested.length} and ${shorter.length} logged nights).`,
    };
  }
  return null;
}
