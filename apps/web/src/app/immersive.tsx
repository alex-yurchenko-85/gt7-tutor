import { createContext, useContext, useEffect } from 'react';

export const ImmersiveContext = createContext<(active: boolean) => void>(() => undefined);

export function useImmersive(active: boolean): void {
  const setImmersive = useContext(ImmersiveContext);
  useEffect(() => {
    setImmersive(active);
    return () => setImmersive(false);
  }, [active, setImmersive]);
}
