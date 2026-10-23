import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharts } from '../src/features/analytics/charts.js';

class MockChart {
  static defaults = { color: '', font: {} };
  static instances = [];
  constructor(canvas, config) { this.canvas = canvas; this.config = config; this.data = config.data; this.options = config.options; this.destroyed = false; this.updateCount = 0; MockChart.instances.push(this); }
  update() { this.updateCount++; }
  destroy() { this.destroyed = true; }
}
const css = (name) => ({ '--text-primary': '#fff', '--accent': '#ddd', '--text-secondary': '#aaa', '--chart-grid': '#333', '--surface': '#111', '--rgb': '220,220,220', '--mut': '#aaa', '--tx': '#fff', '--glow': '#ddd' }[name] || '#fff');

function installEnvironment({ missingCanvas = null, chart = MockChart } = {}) {
  globalThis.window = { Chart: chart };
  globalThis.document = { getElementById: (id) => id === missingCanvas ? null : { id } };
}

test('chart updates reuse instances, and rebuild destroys old instances first', () => {
  MockChart.instances = []; installEnvironment();
  const warnings = [], charts = createCharts({ css, warn: (message) => warnings.push(message) });
  assert.equal(charts.rebuild(), true);
  assert.equal(MockChart.instances.length, 3);
  assert.equal(charts.restyle(), true);
  assert.equal(MockChart.instances.length, 3); // Theme changes restyle rather than reinitialize canvases.
  const sample = { dailyBars: [50, null], dailyAverage: [50, null], plannedDays: [false, false], weekly: [{ start: 1, end: 7, rate: 50, done: 1, goal: 2, includesPlan: false }], overallPercent: 50 };
  charts.update(sample); charts.update(sample);
  assert.ok(MockChart.instances.every((chart) => chart.updateCount === 3));
  assert.equal(charts.update({ dailyBars: [], dailyAverage: [], plannedDays: [], weekly: [], overallPercent: 0 }), true);
  assert.equal(charts.rebuild(), true);
  assert.ok(MockChart.instances.slice(0, 3).every((chart) => chart.destroyed));
  assert.equal(MockChart.instances.length, 6);
  assert.deepEqual(warnings, []);
});

test('missing chart library and canvas fail safely without creating charts', () => {
  MockChart.instances = []; installEnvironment({ chart: null });
  const warnings = [], charts = createCharts({ css, warn: (message) => warnings.push(message) });
  assert.equal(charts.rebuild(), false); charts.update({});
  assert.match(warnings[0], /Chart.js/);
  installEnvironment({ missingCanvas: 'weeklyChart' });
  assert.equal(charts.rebuild(), false);
  assert.match(warnings[1], /missing/);
  assert.equal(MockChart.instances.length, 0);
});


