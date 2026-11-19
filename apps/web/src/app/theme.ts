import { readStored, writeStored } from './storage.ts';

export type ThemeChoice = 'system' | 'light' | 'dark';

const THEME_KEY = 'gt7.theme';

export function storedTheme(): ThemeChoice {
  const value = readStored(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function chooseTheme(choice: ThemeChoice): void {
  writeStored(THEME_KEY, choice === 'system' ? null : choice);
  applyTheme(choice);
}
