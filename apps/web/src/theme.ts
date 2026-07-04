import type { BottleneckSeverity, EdgeKind } from '@codeviz/shared';

export type ThemeMode = 'light' | 'dark';

/**
 * Edge kinds are categorical identity (dataviz reference palette, slots 1–5,
 * fixed order). Both mode columns are validated against their surfaces; CVD
 * separation sits in/near the floor band, so every kind also carries a dash
 * pattern (secondary encoding) and the legend labels it.
 */
const EDGE_META: Record<EdgeKind, { dash?: string; label: string }> = {
  import: { label: 'import' }, // solid
  http: { dash: '7 4', label: 'HTTP call' },
  invoke: { dash: '2 4', label: 'Lambda invoke' },
  db: { dash: '10 3 2 3', label: 'database' },
  queue: { dash: '14 6', label: 'queue/event' },
};

const EDGE_COLORS: Record<ThemeMode, Record<EdgeKind, string>> = {
  dark: { import: '#3987e5', http: '#199e70', invoke: '#c98500', db: '#008300', queue: '#9085e9' },
  light: { import: '#2a78d6', http: '#1baf7a', invoke: '#eda100', db: '#008300', queue: '#4a3aa7' },
};

export function edgeStyle(kind: EdgeKind, theme: ThemeMode) {
  const meta = EDGE_META[kind] ?? EDGE_META.import;
  return { ...meta, color: EDGE_COLORS[theme][kind] ?? EDGE_COLORS[theme].import };
}

export const EDGE_KINDS = Object.keys(EDGE_META) as EdgeKind[];

/** Excalidraw-style square grid: 20px cells, bolder line every 5 cells. */
export const GRID = {
  size: 20,
  boldEvery: 5,
  minor: { dark: 'rgba(255,255,255,0.06)', light: 'rgba(0,0,0,0.07)' },
  major: { dark: 'rgba(255,255,255,0.13)', light: 'rgba(0,0,0,0.16)' },
} as const;

/** Status palette (reserved — icon + label always accompany the color). */
export const SEVERITY_STYLE: Record<BottleneckSeverity, { color: string; label: string; icon: string }> = {
  low: { color: '#fab219', label: 'low', icon: '▲' },
  medium: { color: '#ec835a', label: 'medium', icon: '▲' },
  high: { color: '#d03b3b', label: 'high', icon: '⬤' },
};

export const TYPE_ICON: Record<string, string> = {
  service: '🛠',
  lambda: 'λ',
  frontend: '▣',
  library: '📦',
  infra: '⚙',
  database: '🗄',
  external: '☁',
  unknown: '·',
};

export const severityRank: Record<BottleneckSeverity, number> = { low: 0, medium: 1, high: 2 };

/** Annotation swatches; the first stroke swatch is the theme's ink. */
export const strokeSwatches = (theme: ThemeMode) => [
  theme === 'dark' ? '#ffffff' : '#0b0b0b',
  '#e66767',
  theme === 'dark' ? '#3987e5' : '#2a78d6',
  '#0ca30c',
  '#eda100',
  theme === 'dark' ? '#9085e9' : '#4a3aa7',
  '#898781',
];

export const FILL_SWATCHES = [
  'transparent',
  'rgba(230,103,103,0.25)',
  'rgba(57,135,229,0.25)',
  'rgba(12,163,12,0.25)',
  'rgba(250,178,25,0.25)',
  'rgba(144,133,233,0.25)',
];

export const STICKY_SWATCHES = ['#f5d76e', '#9ec5f4', '#a8e6c9', '#e8a4c4', '#d9d4c5'];
