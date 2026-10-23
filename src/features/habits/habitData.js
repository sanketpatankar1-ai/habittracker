export const SUGGEST = ['Drink water', 'Walk 10k steps', 'Journal', 'Stretch', 'Read 10 pages', 'Take vitamins'];

const EMO = [
  [/gym|workout|lift/i, '💪'], [/read/i, '📖'], [/water|hydrat/i, '💧'], [/run|jog/i, '🏃'],
  [/medit/i, '🧘'], [/sleep|bed/i, '🌙'], [/walk|steps/i, '🚶'], [/journal|write|diary/i, '✍️'],
  [/study|learn/i, '📚'], [/code|project/i, '💻'], [/stretch|yoga/i, '🤸'], [/vitamin|supplement/i, '💊'],
  [/cook|meal/i, '🍳'], [/plan/i, '🗓️'], [/wake|alarm|early/i, '⏰'],
];

export function parseHabits(text) {
  return text.split(/[\n,;]+/).map((item) => item.trim().replace(/^([-*•]|\d+[.)])\s*/, '')).filter(Boolean).map((rawTitle) => {
    let title = rawTitle, emoji = '';
    const match = title.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u);
    if (match) { emoji = match[1]; title = title.slice(match[0].length); }
    if (!title) return null;
    if (!emoji) emoji = EMO.find(([pattern]) => pattern.test(title))?.[1] || '📌';
    return { id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, title, emoji };
  }).filter(Boolean);
}
