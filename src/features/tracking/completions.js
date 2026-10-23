/** Apply a single canonical habit/date value and restore the previous value if persistence fails. */
export function persistCompletion(checksData, monthKey, habitId, day, checked, persist) {
  if (!checksData || typeof checksData !== 'object' || Array.isArray(checksData)
    || typeof monthKey !== 'string' || typeof habitId !== 'string'
    || !Number.isInteger(day) || day < 1 || day > 31 || typeof checked !== 'boolean'
    || typeof persist !== 'function') return false;

  const monthExisted = Object.hasOwn(checksData, monthKey);
  if (!checksData[monthKey] || typeof checksData[monthKey] !== 'object' || Array.isArray(checksData[monthKey])) checksData[monthKey] = {};
  const habitExisted = Object.hasOwn(checksData[monthKey], habitId);
  if (!checksData[monthKey][habitId] || typeof checksData[monthKey][habitId] !== 'object' || Array.isArray(checksData[monthKey][habitId])) checksData[monthKey][habitId] = {};
  const dayKey = String(day), dayExisted = Object.hasOwn(checksData[monthKey][habitId], dayKey);
  const previous = checksData[monthKey][habitId][dayKey];
  checksData[monthKey][habitId][dayKey] = checked;

  let saved = false;
  try { saved = persist(checksData) === true; } catch { saved = false; }
  if (saved) return true;

  if (dayExisted) checksData[monthKey][habitId][dayKey] = previous;
  else delete checksData[monthKey][habitId][dayKey];
  if (!Object.keys(checksData[monthKey][habitId]).length && !habitExisted) delete checksData[monthKey][habitId];
  if (!Object.keys(checksData[monthKey]).length && !monthExisted) delete checksData[monthKey];
  return false;
}
