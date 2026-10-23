import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_DEFAULT, THEME_PALETTES, THEME_SWATCHES, validHex, normalizeTheme, paletteFor, relativeLuminance, contrastColor } from '../src/features/themes/palette.js';
import { createSafeStorage } from '../src/features/storage/localStorage.js';
import { calculateDashboardAnalytics } from '../src/features/analytics/calculations.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function contrastRatio(one, two) {
  const a = relativeLuminance(one), b = relativeLuminance(two);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('every preset has readable foreground colors in light and dark modes', () => {
  for (const preset of Object.keys(THEME_PALETTES)) for (const appearance of ['dark', 'light']) {
    const theme = normalizeTheme({ preset, appearance });
    const palette = paletteFor(theme);
    assert.ok(contrastRatio(palette.text, palette.surface) >= 4.5, `${preset}/${appearance} panel text`);
    assert.ok(contrastRatio(palette.bodyText, palette.background) >= 4.5, `${preset}/${appearance} body text`);
    assert.ok(contrastRatio(contrastColor(theme.accent), theme.accent) >= 4.5, `${preset}/${appearance} accent text`);
  }
});

test('custom colors and density normalize safely, and invalid values fall back to defaults', () => {
  const custom = normalizeTheme({ preset:'violet', appearance:'light', accent:'#14aacc', background:'#fafafa', surface:'#e7e7e7', density:'spacious' });
  assert.deepEqual(custom, { preset:'violet', appearance:'light', accent:'#14aacc', background:'#fafafa', surface:'#e7e7e7', density:'spacious' });
  assert.equal(validHex('#AABBCC'), true);
  for (const invalid of ['red', '#123', '#12zz00', null]) assert.equal(validHex(invalid), false);
  assert.equal(normalizeTheme({ preset:'unknown', appearance:'sepia', accent:'blue', background:'no', surface:'#123', density:'huge' }).preset, THEME_DEFAULT.preset);
  assert.equal(normalizeTheme({ density:'huge' }).density, THEME_DEFAULT.density);
  assert.equal(THEME_SWATCHES.length > 0, true);
});

test('theme and dashboard settings persist without replacing habit or analytics data', () => {
  const storage = new MemoryStorage(), warnings = [], safe = createSafeStorage((message) => warnings.push(message), storage);
  const habitRecords = [{ id:'h1', title:'Walk' }], checks = { '2026-9':{h1:{17:true}} };
  safe.write('ht_habits', habitRecords); safe.write('ht_checks', checks);
  const selected = normalizeTheme({ preset:'sage', appearance:'light', accent:'#cc7755', background:'#f1f2eb', surface:'#fbfcf8', density:'compact' });
  assert.equal(safe.write('ht_theme_settings', selected), true);
  assert.equal(safe.write('ht_focus_mode', true), true);
  const refreshedTheme = normalizeTheme(safe.read('ht_theme_settings', null));
  assert.deepEqual(refreshedTheme, selected);
  assert.equal(safe.read('ht_focus_mode', false), true);
  assert.deepEqual(safe.read('ht_habits', []), habitRecords);
  assert.deepEqual(safe.read('ht_checks', {}), checks);
  assert.deepEqual(warnings, []);
});

test('switching among themes leaves the analytics snapshot identical for the same tracker input', () => {
  const input = {
    habits:[{ id:'h1', title:'Walk', emoji:'🚶', startDate:'2026-10-01', schedule:[1,3,5] }],
    checksData:{ '2026-9':{h1:{2:true,7:true,9:true,16:true}} },
    sleepData:{ '2026-9':{2:8,7:6,9:7} }, year:2026, month:9, now:new Date(2026,9,17,12),
  };
  const before = calculateDashboardAnalytics(input);
  for (const preset of Object.keys(THEME_PALETTES)) for (const appearance of ['dark','light']) {
    paletteFor(normalizeTheme({ preset, appearance }));
    assert.deepEqual(calculateDashboardAnalytics(input), before);
  }
});
