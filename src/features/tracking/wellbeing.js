import { getDaysInMonth, getMonthKey } from '../analytics/calculations.js';

export function renderWellbeing({ year, month, moodData, sleepData, save, css, warn, $ }) {
  const key = getMonthKey(year, month), dayCount = getDaysInMonth(year, month);
  moodData[key] ||= {}; sleepData[key] ||= {};
  const average = (store, id, minimum, maximum) => {
    const values = Object.entries(store[key]).filter(([day, value]) => Number.isInteger(Number(day)) && Number(day) >= 1 && Number(day) <= dayCount && value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= minimum && Number(value) <= maximum).map(([, value]) => Number(value));
    const target = $(id);
    target.textContent = values.length ? `Avg ${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)}` : 'Avg —';
    target.title = values.length ? `Average of ${values.length} valid entries in this month.` : 'No valid entries in this month.';
  };
  const moodRow = $('moodRow'), sleepRow = $('sleepRow');
  moodRow.replaceChildren(); sleepRow.replaceChildren();
  for (let day = 1; day <= 31; day++) {
    if (day > dayCount) { moodRow.appendChild(document.createElement('i')); sleepRow.appendChild(document.createElement('i')); continue; }
    const mood = document.createElement('button'); mood.className = 'md'; mood.type = 'button';
    mood.setAttribute('aria-label', `Mood, day ${day}`);
    const paintMood = () => {
      const value = Number(moodData[key][day]) || 0;
      mood.style.setProperty('--v', value / 5);
      mood.title = value ? `Mood ${value} of 5` : 'Tap to rate mood';
    };
    paintMood();
    mood.addEventListener('click', () => {
      moodData[key][day] = (((Number(moodData[key][day]) || 0) + 1) % 6) || '';
      save(); paintMood(); average(moodData, 'moodAvg', 1, 5);
    });
    moodRow.appendChild(mood);

    const sleep = document.createElement('input'); sleep.type = 'text'; sleep.inputMode = 'decimal'; sleep.maxLength = 5;
    sleep.placeholder = '·'; sleep.value = sleepData[key][day] ?? '';
    sleep.setAttribute('aria-label', `Sleep hours, day ${day}`);
    const tint = () => {
      const value = parseFloat(sleep.value);
      sleep.style.background = value ? `rgba(${css('--rgb')},${Math.min(value / 9, 1) * 0.2})` : 'transparent';
    };
    tint(); sleep.addEventListener('input', tint);
    sleep.addEventListener('change', () => {
      const value = sleep.value.trim();
      if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 24)) {
        warn('Sleep hours must be between 0 and 24.'); sleep.value = sleepData[key][day] ?? ''; return;
      }
      sleepData[key][day] = value === '' ? '' : Number(value);
      save(); average(sleepData, 'sleepAvg', 0, 24);
    });
    sleepRow.appendChild(sleep);
  }
  average(moodData, 'moodAvg', 1, 5); average(sleepData, 'sleepAvg', 0, 24);
}
