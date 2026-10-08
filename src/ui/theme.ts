import { Platform, StyleSheet } from 'react-native';

export type ThemeMode = 'dark' | 'light';

/** "Sils-Maria at dusk": near-black, off-white ink, one warm accent. No red anywhere time-related. */
const dark = {
  bg: '#0F0E0D',
  surface: '#1A1917',
  line: '#2A2825',
  ink: '#EDE8DF',
  muted: '#8E887E',
  faint: '#5C5850',
  accent: '#D9A441',
  /** Pressed state of a gold button. */
  accentPressed: '#B8862E',
  /** Behind a selected chip, and behind the cards that ask something of you. */
  accentSoft: '#2A2214',
  accentCard: '#17140F',
  /** Text on a gold button. */
  onAccent: '#17130A',
  /** The only saturated moment in the UI, so it actually lands. */
  win: '#F2C14E',
  mic: '#F0C46A',
  /** Dims what's behind a sheet or the evidence flash. */
  scrim: 'rgba(15,14,13,0.6)',
  scrimStrong: 'rgba(15,14,13,0.82)',
};

/** The same at noon: warm paper, dark ink, the gold darkened so it still reads. Opt-in. */
const light: typeof dark = {
  bg: '#F5F1E8',
  surface: '#FFFCF5',
  line: '#E0D8C8',
  ink: '#1F1D1A',
  muted: '#68625A',
  faint: '#9A9387',
  accent: '#9A6A14',
  accentPressed: '#7E560F',
  accentSoft: '#F1E3C4',
  accentCard: '#FBF3E1',
  onAccent: '#FFFCF5',
  win: '#B7820F',
  mic: '#C9963A',
  scrim: 'rgba(31,29,26,0.35)',
  scrimStrong: 'rgba(245,241,232,0.9)',
};

let palette = dark;
let version = 0;

/**
 * Always the current palette. Screens remount when the mode changes (ThemeProvider),
 * so reading colors.x during render picks up the new value.
 */
export const colors = {} as typeof dark;
for (const key of Object.keys(dark) as (keyof typeof dark)[]) {
  Object.defineProperty(colors, key, { get: () => palette[key], enumerable: true });
}

export function setThemeMode(mode: ThemeMode): void {
  const next = mode === 'light' ? light : dark;
  if (next === palette) return;
  palette = next;
  version++;
}

export function themeMode(): ThemeMode {
  return palette === light ? 'light' : 'dark';
}

/** StyleSheet.create, rebuilt for the current palette the first time it's read after a switch. */
export function themed<T extends StyleSheet.NamedStyles<T>>(make: () => T): T {
  let sheet: T | undefined;
  let builtFor = -1;
  return new Proxy({} as T, {
    get(_, key) {
      if (builtFor !== version || !sheet) { sheet = StyleSheet.create(make()); builtFor = version; }
      return sheet[key as keyof T];
    },
  });
}

export const fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Times New Roman", serif' }),
  sans: Platform.select({ ios: 'System', android: 'sans-serif', default: 'system-ui, -apple-system, sans-serif' }),
};

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 };
