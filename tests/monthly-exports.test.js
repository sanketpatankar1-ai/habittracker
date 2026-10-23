import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { buildImagePdfBlob, buildMonthlyCsv, makePrintReadyHtml, renderMonthlyReportCanvas } from '../src/features/exports/monthlyExports.js';

test('PDF builder creates a valid multi-page PDF download with correct cross-reference offsets', async () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const blob = buildImagePdfBlob([{ jpegBytes: jpeg, width: 1200, height: 1552 }, { jpegBytes: jpeg, width: 1200, height: 300 }]);
  const bytes = new Uint8Array(await blob.arrayBuffer()), pdf = new TextDecoder().decode(bytes);
  assert.equal(blob.type, 'application/pdf');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.match(pdf, /\/Count 2/);
  assert.match(pdf, /\/Filter \/DCTDecode/);
  assert.match(pdf, /%%EOF$/);
  const start = Number(pdf.match(/startxref\n(\d+)\n%%EOF$/)?.[1]);
  assert.equal(new TextDecoder().decode(bytes.slice(start, start + 4)), 'xref');
  assert.throws(() => buildImagePdfBlob([]), /no pages/);
  assert.throws(() => buildImagePdfBlob([{ jpegBytes: jpeg, width: 0, height: 1 }]), /invalid/);
});

test('PDF action creates a valid print-ready report document', () => {
  const html = makePrintReadyHtml('<!doctype html><html><body><h1>October report</h1></body></html>');
  const printCode = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.match(html, /<h1>October report<\/h1>/);
  assert.ok(printCode);
  assert.doesNotThrow(() => new Script(printCode));
  assert.throws(() => makePrintReadyHtml('<html><div>invalid report</div></html>'), /closing body/);
});

test('monthly CSV includes each scheduled historical occurrence once with UTF-8 and escaped text', () => {
  const habit = { id: 'h1', title: 'Walk, "then" stretch\n你好', category: 'Health', startDate: '2026-10-01', schedule: [4, 5] };
  const csv = buildMonthlyCsv({
    report: { year: 2026, month: 9, endDay: 3 }, habits: [habit], archivedHabits: [habit],
    checksData: { '2026-9': { h1: { 1: true } } },
  });
  assert.ok(csv.startsWith('\uFEFF"Date","Habit ID","Habit","Category","Status"\r\n'));
  assert.ok(csv.includes('"2026-10-01","h1","Walk, ""then"" stretch\n你好","Health","Completed"'));
  assert.ok(csv.includes('"2026-10-02","h1","Walk, ""then"" stretch\n你好","Health","Not completed"'));
  assert.equal(csv.match(/"h1"/g)?.length, 2, 'duplicate habit IDs do not duplicate records');
});

test('monthly CSV safely quotes spreadsheet formulas and represents an empty month with headers only', () => {
  const csv = buildMonthlyCsv({
    report: { year: 2026, month: 0, endDay: 1 },
    habits: [{ id: 'h', title: '=HYPERLINK("bad")', startDate: '2026-01-01', schedule: [4] }],
  });
  assert.ok(csv.includes("'=HYPERLINK("));
  const empty = buildMonthlyCsv({ report: { year: 2026, month: 0, endDay: 0 } });
  assert.equal(empty.split('\r\n').filter(Boolean).length, 1);
});

test('monthly CSV respects start dates, archive dates, leap-month ranges, and archived history', () => {
  const report = { year: 2024, month: 1, endDay: 29 };
  const habits = [
    { id: 'new', title: 'New habit', startDate: '2024-02-29', schedule: [4] },
  ];
  const archivedHabits = [
    { id: 'old', title: 'Archived habit', startDate: '2024-02-01', archivedAt: '2024-02-28', schedule: [4] },
  ];
  const csv = buildMonthlyCsv({ report, habits, archivedHabits, checksData: { '2024-1': { old: { 1: true }, new: { 29: true } } } });
  assert.ok(csv.includes('"2024-02-01","old","Archived habit"'));
  assert.ok(csv.includes('"2024-02-29","new","New habit"'));
  assert.ok(!csv.includes('"2024-02-29","old"'));
  assert.equal((csv.match(/"old"/g) || []).length, 4, 'archived scheduled days through archive date remain exported');
});

test('repeated CSV exports are stable, do not mutate tracker data, and reflect updated checks', () => {
  const input = {
    report: { year: 2026, month: 9, endDay: 1 },
    habits: [{ id: 'h', title: 'Read', startDate: '2026-10-01', schedule: [4] }],
    checksData: { '2026-9': { h: { 1: false } } },
  };
  const before = JSON.stringify(input), first = buildMonthlyCsv(input), second = buildMonthlyCsv(input);
  assert.equal(first, second);
  assert.equal(JSON.stringify(input), before);
  input.checksData['2026-9'].h[1] = true;
  assert.notEqual(buildMonthlyCsv(input), first);
  assert.ok(buildMonthlyCsv(input).includes('"2026-10-01","h","Read","","Completed"'));
});

test('PNG report canvas has bounded high resolution and handles long names and empty data', () => {
  const drawn = [];
  const fills = [];
  const context = {
    measureText: (value) => ({ width: String(value).length * 8 }),
    scale: () => {}, fillRect() { fills.push(this.fillStyle); }, strokeRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    fillText: (value) => drawn.push(String(value)),
  };
  let canvas;
  const createCanvas = () => (canvas = { getContext: () => context });
  renderMonthlyReportCanvas({
    monthLabel: 'October 2026', percent: 50, done: 2, goal: 4, missed: 2,
    rows: [{ emoji: '📚', title: 'Habit '.repeat(60), done: 2, goal: 4, percent: 50, grade: { mark: 'F' } }],
  }, { createCanvas });
  assert.equal(canvas.width, 2400);
  assert.ok(canvas.height > 0 && canvas.height <= 16000);
  assert.ok(drawn.some((value) => value.includes('…')));

  renderMonthlyReportCanvas({ monthLabel: 'May 2026', percent: 100, done: 1, goal: 1, missed: 0, rows: [] }, {
    createCanvas, background: '#f3f5f7', surface: '#ffffff', text: '#20252c', muted: '#5b6470', line: '#d7dce2', accent: '#364152',
  });
  assert.ok(fills.includes('#f3f5f7') && fills.includes('#ffffff'), 'PNG drawing uses the selected light-theme colors');

  const manyRows = Array.from({ length: 80 }, (_, index) => ({ title: `Habit ${index}`, done: 0, goal: 1, percent: 0, grade: { mark: 'F' } }));
  const many = renderMonthlyReportCanvas({ monthLabel: 'May 2026', percent: 0, done: 0, goal: 80, missed: 80, rows: manyRows }, { createCanvas });
  assert.ok(many.height > 8_000, 'PNG height expands to include a large habit list');

  const empty = renderMonthlyReportCanvas({ monthLabel: 'January 2026', percent: null, done: 0, goal: 0, missed: 0, rows: [] }, { createCanvas });
  assert.ok(empty.height > 0);
  assert.ok(drawn.includes('No habits are available for this reporting period.'));
});
