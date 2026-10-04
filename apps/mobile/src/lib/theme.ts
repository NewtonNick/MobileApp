/**
 * Cool light and dark surfaces. Green, amber, and red are status only.
 * Spacing is an 8pt grid. Interactive controls are at least 44pt tall.
 */
export type Palette = {
  bg: string;
  bgMuted: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  line: string;
  preview: string;
  danger: string;
  good: string;
  warnSoft: string;
  goodSoft: string;
  dangerSoft: string;
  shadow: string;
  shadowOpacity: number;
  boxShadow: string;
};

export const lightColors: Palette = {
  bg: '#F4F7F8',
  bgMuted: '#E7EEEF',
  surface: '#FFFFFF',
  text: '#122126',
  muted: '#5C6B73',
  accent: '#0A5C56',
  accentSoft: '#E3F4F2',
  accentText: '#FFFFFF',
  line: '#D5DEE2',
  preview: '#9A4E0C',
  danger: '#9E382C',
  good: '#0C7A42',
  warnSoft: '#FFF1E4',
  goodSoft: '#E5F6EC',
  dangerSoft: '#FDECEA',
  shadow: '#122126',
  shadowOpacity: 0.06,
  boxShadow: '0 8px 24px rgba(18, 33, 38, 0.06)',
};

export const darkColors: Palette = {
  bg: '#0E1416',
  bgMuted: '#1A2326',
  surface: '#172023',
  text: '#F3F6F5',
  muted: '#9AABA8',
  accent: '#2EBEB0',
  accentSoft: '#14332F',
  accentText: '#06211E',
  line: '#2C383C',
  preview: '#F0A04B',
  danger: '#FF6B5C',
  good: '#3DDC84',
  warnSoft: '#3A2A16',
  goodSoft: '#123224',
  dangerSoft: '#3A1C18',
  shadow: '#000000',
  shadowOpacity: 0.4,
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
};

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  pill: 999,
};
