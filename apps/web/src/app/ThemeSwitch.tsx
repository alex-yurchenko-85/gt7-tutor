import { useState } from 'react';
import { Icon, type IconName } from './icons.tsx';
import { RadioGroup, type RadioOption } from './RadioGroup.tsx';
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
  const options: RadioOption<ThemeChoice>[] = THEMES.map(option => ({
    value: option.value,
    ariaLabel: compact ? `${option.label} theme` : undefined,
    title: compact ? `${option.label} theme` : undefined,
    content: (
      <>
        <Icon name={option.icon} size={18} />
        {compact ? null : <span>{option.label}</span>}
      </>
    )
  }));
  return <RadioGroup className={`theme-switch${compact ? ' compact' : ''}`} label="Theme" options={options} value={theme} onChange={select} />;
}
