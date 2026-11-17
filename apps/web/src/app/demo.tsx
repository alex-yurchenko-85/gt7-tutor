import { createContext, useContext } from 'react';
import type { DemoInfo } from '@gt7/contracts';

export const DEMO_LABEL = 'Demo: recorded data, no console';

export const DemoContext = createContext<DemoInfo | null>(null);

export function useDemo(): DemoInfo | null {
  return useContext(DemoContext);
}

export function DemoLabel() {
  const demo = useDemo();
  if (!demo) return null;
  return (
    <p className="demo-label" role="note">
      {DEMO_LABEL}
    </p>
  );
}
