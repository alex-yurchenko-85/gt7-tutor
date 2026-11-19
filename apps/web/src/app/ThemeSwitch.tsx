import { useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from './icons.tsx';
import { chooseTheme, storedTheme, type ThemeChoice } from './theme.ts';

const THEMES: { value: ThemeChoice; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' }
];

export function ThemeSwitch({ compact }: { compact: boolean }) {
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme);
  const select = (choice: ThemeChoice) => {
    setTheme(choice);
    chooseTheme(choice);
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = THEMES.findIndex(option => option.value === theme);
    const next = THEMES[(index + step + THEMES.length) % THEMES.length]!;
    select(next.value);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-theme-choice="${next.value}"]`)?.focus();
  };
  return (
    <div className={`theme-switch${compact ? ' compact' : ''}`} role="radiogroup" aria-label="Theme" onKeyDown={move}>
      {THEMES.map(option => {
        const checked = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={compact ? `${option.label} theme` : undefined}
            title={compact ? `${option.label} theme` : undefined}
            tabIndex={checked ? 0 : -1}
            data-theme-choice={option.value}
            onClick={() => select(option.value)}
          >
            <Icon name={option.icon} size={18} />
            {compact ? null : <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
