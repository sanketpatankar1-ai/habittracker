import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

test('legacy standalone dashboard script parses and keeps its data export control', async () => {
  const html = await readFile(new URL('../habit_tracker_v4_notes (1).html', import.meta.url), 'utf8');
  const bodyStart = html.indexOf('<body');
  const scriptStart = html.indexOf('<script>', bodyStart);
  const scriptEnd = html.indexOf('</script>', scriptStart);

  assert.notEqual(bodyStart, -1, 'legacy page body exists');
  assert.notEqual(scriptStart, -1, 'legacy app script exists');
  assert.notEqual(scriptEnd, -1, 'legacy app script closes');
  assert.doesNotThrow(() => new Script(html.slice(scriptStart + '<script>'.length, scriptEnd)));
  assert.equal(html.split('id="legacyExportBtn"').length - 1, 1);
});
