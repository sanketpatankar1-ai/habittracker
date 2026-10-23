export const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
export const getMonthKey = (year, month) => `${year}-${month}`;
export const localISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const dateFor = (year, month, day) => new Date(year, month, day, 12, 0, 0, 0);
export function isHabitActiveOnDate(habit, date) {
  const iso = localISO(date);
  return !(Array.isArray(habit.inactivePeriods) && habit.inactivePeriods.some((period) =>
    isValidLocalDate(period?.startDate) && isValidLocalDate(period?.endDate) && iso >= period.startDate && iso <= period.endDate));
}

export function isScheduled(habit, date) {
  if (!habit || !(date instanceof Date) || !Number.isFinite(date.getTime()) || !isHabitActiveOnDate(habit, date)) return false;
  const iso = localISO(date);
  const historical = Array.isArray(habit.scheduleHistory) && habit.scheduleHistory.find((period) =>
    isValidLocalDate(period?.startDate) && isValidLocalDate(period?.endDate) && Array.isArray(period.schedule)
      && iso >= period.startDate && iso <= period.endDate);
  const schedule = historical?.schedule || (isValidLocalDate(habit.scheduleStartDate) && iso < habit.scheduleStartDate
    ? (Array.isArray(habit.scheduleHistory) ? habit.scheduleHistory.find((period) => iso >= period.startDate)?.schedule : null)
    : habit.schedule);
  return Array.isArray(schedule) ? schedule.includes(date.getDay()) : true;
}
export const isValidLocalDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number), date = dateFor(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};
const startDateOf = (habit) => isValidLocalDate(habit.startDate) ? habit.startDate : '0001-01-01';
/** Shared denominator rule for one habit/date pair: started and scheduled. */
export function isHabitEligibleOnDate(habit, date) {
  return !!habit && date instanceof Date && Number.isFinite(date.getTime())
    && localISO(date) >= startDateOf(habit) && isScheduled(habit, date);
}

/** Sunday–Saturday calendar weeks, clipped to the selected month. */
export function getWeekRanges(year, month) {
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 0 || month > 11) return [];
  const days = getDaysInMonth(year, month), ranges = [];
  for (let start = 1; start <= days;) {
    const end = Math.min(days, start + (start === 1 ? 6 - dateFor(year, month, 1).getDay() : 6));
    ranges.push({ start, end });
    start = end + 1;
  }
  return ranges;
}

const emptyAnalytics = () => ({ habitStats: [], done: 0, planned: 0, monthGoal: 0, remaining: 0, overallPercent: 0, dailyRates: [], dailyBars: [], dailyAverage: [], plannedDays: [], weekly: [], averageDailyRate: 0, latestElapsedDay: -1 });

function streaksFor(habit, checksData, today) {
  const qualifies = (date) => {
    if (!isHabitEligibleOnDate(habit, date)) return null;
    return checksData?.[getMonthKey(date.getFullYear(), date.getMonth())]?.[habit.id]?.[date.getDate()] === true;
  };

  const end = new Date(today);
  if (qualifies(end) === null || (!qualifies(end) && end.getTime() === today.getTime())) end.setDate(end.getDate() - 1);
  let firstChecked = null;
  for (const [key, month] of Object.entries(checksData || {})) {
    const match = /^(\d{1,4})-(\d{1,2})$/.exec(key), log = month?.[habit.id];
    if (!match || !log) continue;
    for (const [rawDay, checked] of Object.entries(log)) {
      if (checked !== true || !/^\d+$/.test(rawDay)) continue;
      const date = dateFor(Number(match[1]), Number(match[2]), Number(rawDay));
      if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) || date.getDate() !== Number(rawDay)) continue;
      const iso = localISO(date);
      if (!firstChecked || iso < firstChecked) firstChecked = iso;
    }
  }
  const definedStart = startDateOf(habit);
  const trackingStart = definedStart !== '0001-01-01' ? definedStart : firstChecked || localISO(today);
  let currentStreak = 0;
  for (let date = new Date(end); date >= new Date(`${trackingStart}T12:00:00`); date.setDate(date.getDate() - 1)) {
    const qualifiesToday = qualifies(date);
    if (qualifiesToday === null) continue;
    if (!qualifiesToday) break;
    currentStreak++;
  }

  const start = new Date(`${trackingStart}T12:00:00`);
  let bestStreak = 0, run = 0;
  for (let date = new Date(start); date <= today; date.setDate(date.getDate() + 1)) {
    const qualifiesToday = qualifies(date);
    if (qualifiesToday === null) continue;
    run = qualifiesToday ? run + 1 : 0;
    bestStreak = Math.max(bestStreak, run);
  }
  return { currentStreak, bestStreak };
}

/**
 * One calculation snapshot feeds cards, habit rows, charts, and highlights.
 * Daily rate = checked active habits / active habits scheduled that date.
 * Weekly rate = checked eligible occurrences / eligible occurrences; future
 * goals join its denominator only when that week contains a pre-marked plan.
 * Month ring = completed + explicitly shown pre-marked plans / full-month
 * scheduled goal. The ring is labeled as a projection in the UI.
 * Habit rate = checked scheduled occurrences / this habit's eligible dates.
 * Seven-day average = the arithmetic mean of valid daily rates in the trailing
 * seven calendar dates, skipping dates with no eligible habits. Values remain
 * unrounded until display.
 */
export function calculateDashboardAnalytics({ habits, checksData, sleepData = {}, year, month, now = new Date() }) {
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 0 || month > 11 || !(now instanceof Date) || !Number.isFinite(now.getTime())) return emptyAnalytics();
  habits = Array.isArray(habits) ? habits.filter((habit) => habit && typeof habit.id === 'string' && habit.id.length) : [];
  const dayCount = getDaysInMonth(year, month);
  // All calendar dates use local noon so comparing a day with "today" does
  // not accidentally classify today as future due to its noon timestamp.
  const today = dateFor(now.getFullYear(), now.getMonth(), now.getDate());
  const dailyDone = Array(dayCount).fill(0), dailyGoal = Array(dayCount).fill(0);
  const dailyPlannedDone = Array(dayCount).fill(0), dailyPlannedGoal = Array(dayCount).fill(0);
  const weekRanges = getWeekRanges(year, month);
  const weeklyTotals = weekRanges.map((range) => ({ ...range, done: 0, goal: 0, plannedDone: 0, plannedGoal: 0 }));
  let done = 0, monthGoal = 0, planned = 0;

  const habitStats = habits.map((habit) => {
    let actual = 0, goalToDate = 0, monthTarget = 0, plannedHabit = 0;
    const checks = checksData?.[getMonthKey(year, month)]?.[habit.id] || {};
    for (let day = 1; day <= dayCount; day++) {
      const date = dateFor(year, month, day);
      if (!isHabitEligibleOnDate(habit, date)) continue;
      monthTarget++;
      const week = weeklyTotals.find((range) => day >= range.start && day <= range.end);
      if (date > today) {
        dailyPlannedGoal[day - 1]++;
        week.plannedGoal++;
        if (checks[day] === true) {
          plannedHabit++;
          dailyPlannedDone[day - 1]++;
          week.plannedDone++;
        }
        continue;
      }
      goalToDate++;
      dailyGoal[day - 1]++;
      week.goal++;
      if (checks[day] === true) {
        actual++;
        dailyDone[day - 1]++;
        week.done++;
      }
    }
    done += actual;
    monthGoal += monthTarget;
    planned += plannedHabit;
    const streaks = streaksFor(habit, checksData, today);
    return {
      id: habit.id, title: habit.title, emoji: habit.emoji,
      goal: goalToDate, actual, left: goalToDate - actual,
      percentage: goalToDate ? actual / goalToDate * 100 : 0,
      planned: plannedHabit, monthGoal: monthTarget, ...streaks,
    };
  });

  // Keep full precision in the calculation model; round only in rendered labels.
  const dailyRates = dailyDone.map((count, index) => dailyGoal[index] ? count / dailyGoal[index] * 100 : null);
  const plannedDays = dailyPlannedDone.map((count, index) => dateFor(year, month, index + 1) > today && count > 0);
  const dailyBars = dailyRates.map((rate, index) => plannedDays[index] && dailyPlannedGoal[index]
    ? dailyPlannedDone[index] / dailyPlannedGoal[index] * 100
    : dateFor(year, month, index + 1) <= today ? rate : null);
  const dailyAverage = dailyRates.map((_, index) => {
    const end = dateFor(year, month, index + 1);
    if (end > today) return null;
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const rates = [];
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const key = getMonthKey(date.getFullYear(), date.getMonth());
      let done = 0, goal = 0;
      for (const habit of habits) {
        if (!isHabitEligibleOnDate(habit, date)) continue;
        goal++;
        if (checksData?.[key]?.[habit.id]?.[date.getDate()] === true) done++;
      }
      if (goal) rates.push(done / goal * 100);
    }
    return rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null;
  });
  const weekly = weeklyTotals.map((week) => {
    const includesPlan = week.plannedDone > 0;
    const denominator = week.goal + (includesPlan ? week.plannedGoal : 0);
    const numerator = week.done + (includesPlan ? week.plannedDone : 0);
    return { ...week, includesPlan, rate: denominator ? numerator / denominator * 100 : null };
  });
  const elapsed = dailyRates.filter((value) => value !== null);
  const averageDailyRate = elapsed.length ? elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length : 0;
  const overallPercent = monthGoal ? (done + planned) / monthGoal * 100 : 0;
  const latestElapsedDay = dailyRates.reduce((last, value, index) => value !== null ? index : last, -1);
  const currentStreak = habitStats.reduce((max, habit) => Math.max(max, habit.currentStreak), 0);
  const topHabits = [...habitStats].sort((a, b) => b.percentage - a.percentage).slice(0, 3);
  const weekdayRates = Array.from({ length: 7 }, () => []);
  dailyRates.forEach((rate, index) => {
    if (rate !== null) weekdayRates[dateFor(year, month, index + 1).getDay()].push(rate);
  });
  let bestWeekday = null;
  weekdayRates.forEach((rates, weekday) => {
    if (!rates.length) return;
    const average = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
    if (!bestWeekday || average > bestWeekday.average) bestWeekday = { weekday, average };
  });
  const sleepBands = { rested: [], shorter: [] }, sleepMonth = sleepData?.[getMonthKey(year, month)] || {};
  for (let index = 0; index <= latestElapsedDay; index++) {
    const raw = sleepMonth[index + 1], rate = dailyRates[index];
    if (rate === null || raw === '' || raw == null || !Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > 24) continue;
    sleepBands[Number(raw) >= 7 ? 'rested' : 'shorter'].push(rate);
  }
  const averageRate = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const restedAverage = averageRate(sleepBands.rested), shorterAverage = averageRate(sleepBands.shorter);
  const sleepComparison = sleepBands.rested.length >= 2 && sleepBands.shorter.length >= 2
    ? { difference: restedAverage - shorterAverage, restedNights: sleepBands.rested.length, shorterNights: sleepBands.shorter.length }
    : null;
  return {
    habitStats, done, planned, monthGoal, remaining: Math.max(0, monthGoal - done - planned), overallPercent,
    dailyRates, dailyBars, dailyAverage, dailyDone, dailyGoal, dailyPlannedDone, dailyPlannedGoal, plannedDays, weekly, averageDailyRate, latestElapsedDay, currentStreak,
    highlights: { topHabits, bestWeekday, sleepComparison },
  };
}

export function progressGrade(percent) {
  if (percent === null || !Number.isFinite(percent)) return { mark: 'N/A', label: 'No reportable scheduled days' };
  if (percent >= 95) return { mark: 'A+', label: 'Outstanding' };
  if (percent >= 90) return { mark: 'A', label: 'Excellent' };
  if (percent >= 80) return { mark: 'B', label: 'Strong progress' };
  if (percent >= 70) return { mark: 'C', label: 'On track' };
  if (percent >= 60) return { mark: 'D', label: 'Room to build consistency' };
  return { mark: 'F', label: 'Keep building the routine' };
}

export function buildMonthlyReportData({ habits, archivedHabits, checksData, moodData, sleepData, year, month, now = new Date() }) {
  const key = getMonthKey(year, month), todayDate = dateFor(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = dateFor(year, month, 1), monthEnd = getDaysInMonth(year, month);
  const endDay = monthStart > todayDate ? 0 : year === todayDate.getFullYear() && month === todayDate.getMonth() ? todayDate.getDate() : monthEnd;
  const all = [...habits, ...archivedHabits], seen = new Set(), rows = [];
  for (const habit of all) {
    if (!habit?.id || seen.has(habit.id)) continue;
    seen.add(habit.id);
    let goal = 0, done = 0;
    const checks = checksData?.[key]?.[habit.id] || {};
    for (let day = 1; day <= endDay; day++) {
      const date = dateFor(year, month, day), iso = localISO(date);
      if (!isHabitEligibleOnDate(habit, date) || (isValidLocalDate(habit.archivedAt) && iso > habit.archivedAt)) continue;
      goal++;
      if (checks[day] === true) done++;
    }
    const percent = goal ? done / goal * 100 : null;
    rows.push({ title: habit.title, emoji: habit.emoji || '📌', category: habit.category || '', goal, done, missed: goal - done, percent, grade: progressGrade(percent) });
  }
  const goal = rows.reduce((sum, habit) => sum + habit.goal, 0), done = rows.reduce((sum, habit) => sum + habit.done, 0);
  const percent = goal ? Math.round(done / goal * 100) : null;
  const average = (store, valid) => {
    const values = Object.entries(store[key] || {}).filter(([day, value]) => Number(day) <= endDay && dateFor(year, month, Number(day)) <= todayDate && value !== '' && value != null && valid(Number(value))).map(([, value]) => Number(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  return {
    year, month, monthLabel: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(dateFor(year, month, 1)),
    endDay, daysInMonth: monthEnd, goal, done, missed: goal - done, percent, grade: progressGrade(percent), rows,
    moodAverage: average(moodData, (value) => Number.isFinite(value) && value >= 1 && value <= 5),
    sleepAverage: average(sleepData, (value) => Number.isFinite(value) && value >= 0 && value <= 24),
  };
}
