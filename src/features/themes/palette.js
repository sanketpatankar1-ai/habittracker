export const THEME_DEFAULT = { preset: 'midnight', appearance: 'dark', accent: '#d9dee8', background: '#080a0f', surface: '#11151c', density: 'comfortable' };
export const THEME_PALETTES = {
  midnight: { dark: ['#080a0f', '#11151c', '#f2f4f8', '#a4aab5', '#303640', '#d9dee8'], light: ['#f1f2f4', '#ffffff', '#20252c', '#5b6470', '#d9dde2', '#596575'] },
  obsidian: { dark: ['#000000', '#080808', '#f5f5f5', '#a6a6a6', '#262626', '#e5e7eb'], light: ['#f1f1f1', '#ffffff', '#202020', '#5b5b5b', '#d5d5d5', '#303030'] },
  'clean-light': { dark: ['#111318', '#191c22', '#f3f4f6', '#a7adb7', '#343941', '#cbd2dd'], light: ['#f3f5f7', '#ffffff', '#20252c', '#5b6470', '#d7dce2', '#364152'] },
  violet: { dark: ['#111019', '#191724', '#f3f0ff', '#b4aec7', '#373148', '#a78bfa'], light: ['#f5f3fa', '#ffffff', '#292333', '#625b70', '#ddd7e8', '#7653c6'] },
  sage: { dark: ['#1d241f', '#272f29', '#eff4ed', '#aebcae', '#414c43', '#8eb49a'], light: ['#f0f2eb', '#fbfcf8', '#25302a', '#59675f', '#d1d9d1', '#557c66'] },
};
export const THEME_SWATCHES = ['#d9dee8', '#a78bfa', '#557c66', '#4f86c6', '#c66b4e', '#d38b32', '#d95d83', '#4d9b75'];

export function validHex(value) { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }

export function normalizeTheme(raw, legacy) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const theme = { ...THEME_DEFAULT, ...source };
  if (!THEME_PALETTES[theme.preset]) theme.preset = 'midnight';
  if (!['light', 'dark'].includes(source.appearance)) theme.appearance = legacy === 'light' ? 'light' : THEME_DEFAULT.appearance;
  if (!validHex(theme.accent)) theme.accent = THEME_DEFAULT.accent;
  if (!validHex(theme.background) || !validHex(theme.surface)) {
    const palette = THEME_PALETTES[theme.preset][theme.appearance];
    theme.background = palette[0]; theme.surface = palette[1];
  }
  if (!['compact', 'comfortable', 'spacious'].includes(theme.density)) theme.density = 'comfortable';
  return theme;
}

export function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastColor(background) {
  const light = relativeLuminance(background), whiteContrast = 1.05 / (light + 0.05), darkContrast = (light + 0.05) / 0.05;
  return whiteContrast >= darkContrast ? '#ffffff' : '#111318';
}

export function mutedColor(background) {
  const light = relativeLuminance(background); let chosen = 128, best = Infinity;
  for (let value = 0; value <= 255; value++) {
    const channel = value.toString(16).padStart(2, '0'), luminance = relativeLuminance(`#${channel}${channel}${channel}`);
    const ratio = (Math.max(light, luminance) + 0.05) / (Math.min(light, luminance) + 0.05);
    if (ratio >= 4.5 && Math.abs(value - 128) < best) { chosen = value; best = Math.abs(value - 128); }
  }
  const channel = chosen.toString(16).padStart(2, '0');
  return `#${channel}${channel}${channel}`;
}

export function paletteFor(theme) {
  const palette = THEME_PALETTES[theme.preset][theme.appearance];
  return {
    background: theme.background, surface: theme.surface, text: contrastColor(theme.surface), muted: mutedColor(theme.surface),
    bodyText: contrastColor(theme.background), bodyMuted: mutedColor(theme.background), border: palette[4], accent: theme.accent,
  };
}

export const rgbFromHex = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(',');
export const accentForeground = (hex) => contrastColor(hex);
