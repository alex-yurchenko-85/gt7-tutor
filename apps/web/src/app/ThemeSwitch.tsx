import { useState } from 'react';
import type { MessageKey } from '@gt7/contracts';
import { Icon, type IconName } from './icons.tsx';
import { RadioGroup, type RadioOption } from './RadioGroup.tsx';
import { chooseTheme, storedTheme, type ThemeChoice } from './theme.ts';
import { t } from './i18n.ts';

const THEMES: { value: ThemeChoice; label: MessageKey; icon: IconName }[] = [
  { value: 'system', label: 'app.theme.system', icon: 'monitor' },
  { value: 'light', label: 'app.theme.light', icon: 'sun' },
  { value: 'dark', label: 'app.theme.dark', icon: 'moon' }
];

export function ThemeSwitch({ compact }: { compact: boolean }) {
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme);
  const select = (choice: ThemeChoice) => {
    setTheme(choice);
    chooseTheme(choice);
  };
  const options: RadioOption<ThemeChoice>[] = THEMES.map(option => ({
    value: option.value,
    ariaLabel: compact ? t('app.theme.choice', { theme: t(option.label) }) : undefined,
    title: compact ? t('app.theme.choice', { theme: t(option.label) }) : undefined,
    content: (
      <>
        <Icon name={option.icon} size={18} />
        {compact ? null : <span>{t(option.label)}</span>}
      </>
    )
  }));
  return <RadioGroup className={`theme-switch${compact ? ' compact' : ''}`} label={t('app.theme.label')} options={options} value={theme} onChange={select} />;
}
