import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { darkColors, lightColors, type Palette } from '@/lib/theme';
import { useHousehold } from '@/state/context';

export type AppearanceChoice = 'system' | 'light' | 'dark';
export type ColorMode = 'light' | 'dark';

const AppearanceContext = createContext<{ colors: Palette; mode: ColorMode } | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { settings } = useHousehold();
  const system = useColorScheme();
  const choice = settings.appearance ?? 'system';
  const mode: ColorMode =
    choice === 'light' || choice === 'dark' ? choice : system === 'dark' ? 'dark' : 'light';
  const colors = mode === 'dark' ? darkColors : lightColors;

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = colors.bg;
    }
  }, [colors.bg]);

  return <AppearanceContext.Provider value={{ colors, mode }}>{children}</AppearanceContext.Provider>;
}

export function useColors(): Palette {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useColors must be used inside AppearanceProvider');
  return value.colors;
}

export function useColorMode(): ColorMode {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useColorMode must be used inside AppearanceProvider');
  return value.mode;
}
