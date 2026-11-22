import { createContext, useContext } from 'react';
import type { DemoInfo } from '@gt7/contracts';
import { t } from './i18n.ts';

export const DemoContext = createContext<DemoInfo | null>(null);

export function useDemo(): DemoInfo | null {
  return useContext(DemoContext);
}

export function DemoLabel() {
  const demo = useDemo();
  if (!demo) return null;
  return (
    <p className="demo-label">
      {t('app.demo.label')}
    </p>
  );
}
