import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeId = 'obsidian' | 'aurora' | 'petrol' | 'sandstone' | 'forest' | 'parchment';

export const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'obsidian',  label: 'Obsidian',  swatch: '#16181e' },
  { id: 'aurora',    label: 'Aurora',    swatch: '#10131f' },
  { id: 'petrol',    label: 'Petrol',    swatch: '#11181b' },
  { id: 'sandstone', label: 'Sandstone', swatch: '#1c1814' },
  { id: 'forest',    label: 'Forest',    swatch: '#131a14' },
  { id: 'parchment', label: 'Parchment', swatch: '#ede5d2' },
];

interface ThemeState {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

export function applyTheme(theme: ThemeId): void {
  if (theme === 'obsidian') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'obsidian',
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
    }),
    { name: 'hc-theme' },
  ),
);
