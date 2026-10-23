import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWellbeing } from '../src/features/tracking/wellbeing.js';

class FakeElement {
  children = [];
  listeners = {};
  attributes = {};
  style = { setProperty() {} };
  replaceChildren(...items) { this.children = [...items]; }
  appendChild(item) { this.children.push(item); return item; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
}

test('wellbeing averages all valid saved entries in the selected month, including future values and zero sleep', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => new FakeElement() };
  try {
    const elements = Object.fromEntries(['moodRow', 'sleepRow', 'moodAvg', 'sleepAvg'].map((id) => [id, new FakeElement()]));
    const month = {
      moodData: { '2026-9': { 1: 5, 2: 3, 19: 4, 20: 2, 0: 4, 32: 3, 21: 8 } },
      sleepData: { '2026-9': { 1: 8, 2: 8, 3: 0, 4: 0, 5: 6, 6: 10, 7: 7, 8: 9, 20: 5, 0: 10, 32: 12, 21: 25 } },
    };
    renderWellbeing({ year: 2026, month: 9, ...month, save() {}, css: () => '217,222,232', warn() {}, $: (id) => elements[id] });
    assert.equal(elements.moodAvg.textContent, 'Avg 3.5');
    assert.equal(elements.sleepAvg.textContent, 'Avg 5.9');
    assert.match(elements.sleepAvg.title, /9 valid entries/);
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
});
