import { dateFor, getMonthKey, isHabitEligibleOnDate, localISO } from '../analytics/calculations.js';

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\t\r ]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildMonthlyCsv({ report, habits = [], archivedHabits = [], checksData = {} }) {
  const rows = [['Date', 'Habit ID', 'Habit', 'Category', 'Status']];
  const seen = new Set();
  const allHabits = [...habits, ...archivedHabits].filter((habit) => {
    if (!habit?.id || seen.has(habit.id)) return false;
    seen.add(habit.id);
    return true;
  });
  const monthKey = getMonthKey(report.year, report.month);
  const monthChecks = checksData?.[monthKey] || {};

  for (let day = 1; day <= report.endDay; day++) {
    const date = dateFor(report.year, report.month, day), iso = localISO(date);
    for (const habit of allHabits) {
      if (habit.archivedAt && iso > habit.archivedAt) continue;
      if (!isHabitEligibleOnDate(habit, date)) continue;
      const done = monthChecks[habit.id]?.[day] === true;
      rows.push([iso, habit.id, habit.title, habit.category || '', done ? 'Completed' : 'Not completed']);
    }
  }

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function makePrintReadyHtml(html) {
  if (typeof html !== 'string' || !/<\/body>/i.test(html)) throw new Error('The monthly report has no closing body element.');
  return html.replace(/<\/body>/i, '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),150));</script></body>');
}

const encoder = new TextEncoder();

function joinBytes(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

/** Build a PDF containing one JPEG image per page. Pages are rendered from the report canvas. */
export function buildImagePdfBlob(pages, { pageWidth = 612 } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('The PDF report has no pages.');
  if (typeof Blob === 'undefined') throw new Error('PDF downloads are unavailable in this environment.');
  const pageCount = pages.length;
  const objects = new Array(2 + pageCount * 3);
  objects[1] = encoder.encode('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = encoder.encode(`<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ')}] /Count ${pageCount} >>`);

  pages.forEach((page, index) => {
    const { jpegBytes, width, height } = page;
    if (!(jpegBytes instanceof Uint8Array) || !jpegBytes.length || !(width > 0) || !(height > 0)) throw new Error('A PDF page image is invalid.');
    const pageId = 3 + index * 3, imageId = pageId + 1, contentId = pageId + 2;
    const pageHeight = pageWidth * height / width;
    const content = encoder.encode(`q\n${pageWidth} 0 0 ${pageHeight.toFixed(3)} 0 0 cm\n/Im0 Do\nQ`);
    objects[pageId] = encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight.toFixed(3)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects[imageId] = joinBytes([
      encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`),
      jpegBytes,
      encoder.encode('\nendstream'),
    ]);
    objects[contentId] = encoder.encode(`<< /Length ${content.length} >>\nstream\n${new TextDecoder().decode(content)}\nendstream`);
  });

  const chunks = [encoder.encode('%PDF-1.4\n% Habit Tracker report\n')], offsets = [0];
  let byteOffset = chunks[0].length;
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = byteOffset;
    const chunk = joinBytes([encoder.encode(`${id} 0 obj\n`), objects[id], encoder.encode('\nendobj\n')]);
    chunks.push(chunk); byteOffset += chunk.length;
  }
  const xrefOffset = byteOffset;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  chunks.push(encoder.encode(`${xref}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return new Blob(chunks, { type: 'application/pdf' });
}

function fitText(context, value, maxWidth) {
  let text = String(value ?? '');
  if (context.measureText(text).width <= maxWidth) return text;
  while (text && context.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}

function wrapText(context, value, maxWidth, maxLines = 2) {
  const words = String(value ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(' ').split(/\s+/).filter(Boolean).length;
  if (consumed < words.length && lines.length) lines[lines.length - 1] = fitText(context, `${lines.at(-1)} ${words.slice(consumed).join(' ')}`, maxWidth);
  return lines.map((line) => fitText(context, line, maxWidth));
}

export function renderMonthlyReportCanvas(report, {
  background = '#11151c', surface = '#191e27', text = '#f2f4f8', muted = '#a4aab5',
  line = '#303640', accent = '#d9dee8', fontFamily = 'system-ui, sans-serif', scale = 2,
  createCanvas = () => document.createElement('canvas'), maxPixelHeight = 16000,
} = {}) {
  const width = 1200, headerHeight = 218, rowHeight = 48;
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const height = headerHeight + Math.max(rows.length, 1) * rowHeight + 32;
  const pixelScale = Math.min(scale, maxPixelHeight / height);
  const canvas = createCanvas();
  canvas.width = Math.round(width * pixelScale);
  canvas.height = Math.round(height * pixelScale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
  context.scale(pixelScale, pixelScale);
  context.fillStyle = background; context.fillRect(0, 0, width, height);
  context.fillStyle = text; context.font = `600 30px ${fontFamily}`;
  context.fillText('Habit Tracker', 40, 48);
  context.fillStyle = muted; context.font = `16px ${fontFamily}`;
  context.fillText(`${report.monthLabel} · Monthly report`, 40, 76);

  const cards = [
    ['Progress', report.percent === null ? '—' : `${report.percent}%`],
    ['Completed', report.done],
    ['Scheduled goal', report.goal],
    ['Remaining', report.missed],
  ];
  const cardY = 98, cardW = 270, cardGap = 12;
  cards.forEach(([label, value], index) => {
    const x = 40 + index * (cardW + cardGap);
    context.fillStyle = surface; context.fillRect(x, cardY, cardW, 74);
    context.strokeStyle = line; context.strokeRect(x + .5, cardY + .5, cardW - 1, 73);
    context.fillStyle = muted; context.font = `14px ${fontFamily}`; context.fillText(label, x + 14, cardY + 25);
    context.fillStyle = text; context.font = `600 24px ${fontFamily}`; context.fillText(String(value), x + 14, cardY + 56);
  });

  const tableY = 202;
  context.fillStyle = surface; context.fillRect(40, tableY, width - 80, 34);
  context.fillStyle = muted; context.font = `600 13px ${fontFamily}`;
  context.fillText('HABIT', 54, tableY + 22);
  context.fillText('DONE / GOAL', 650, tableY + 22);
  context.fillText('PROGRESS', 820, tableY + 22);
  context.fillText('MARK', 1080, tableY + 22);

  if (!rows.length) {
    context.fillStyle = muted; context.font = `16px ${fontFamily}`;
    context.fillText('No habits are available for this reporting period.', 54, tableY + 66);
  }
  rows.forEach((habit, index) => {
    const y = tableY + 34 + index * rowHeight;
    context.strokeStyle = line; context.beginPath(); context.moveTo(40, y + rowHeight); context.lineTo(width - 40, y + rowHeight); context.stroke();
    context.fillStyle = text; context.font = `15px ${fontFamily}`;
    const nameLines = wrapText(context, `${habit.emoji || ''} ${habit.title || ''}`.trim(), 560);
    nameLines.forEach((name, lineIndex) => context.fillText(name, 54, y + 20 + lineIndex * 17));
    context.fillStyle = muted; context.font = `14px ${fontFamily}`;
    context.fillText(`${habit.done} / ${habit.goal}`, 650, y + 27);
    context.fillStyle = surface; context.fillRect(820, y + 15, 190, 9);
    context.fillStyle = accent; context.fillRect(820, y + 15, 190 * Math.max(0, Math.min(100, habit.percent || 0)) / 100, 9);
    context.fillStyle = text; context.fillText(habit.percent === null ? '—' : `${Math.round(habit.percent)}%`, 1020, y + 27);
    context.fillText(habit.grade?.mark || '—', 1090, y + 27);
  });
  return canvas;
}
