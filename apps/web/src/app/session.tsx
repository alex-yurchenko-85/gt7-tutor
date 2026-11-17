import { createContext, useContext } from 'react';
import type { ProfileUser } from '@gt7/contracts';

export type Session = { user: ProfileUser; signOut(): Promise<void> };

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession needs a signed-in profile');
  return session;
}
