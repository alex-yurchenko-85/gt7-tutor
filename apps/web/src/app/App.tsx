import { useCallback, useMemo, useRef } from 'react';
import type { AuthState } from '@gt7/contracts';
import { api } from '../api/client.ts';
import { LiveProvider, type SocketFactory } from '../api/live.tsx';
import { FirstProfileView, SignInView } from '../features/auth/AccessView.tsx';
import type { VoicePlayer } from '../voice/VoicePlayer.ts';
import { DemoContext } from './demo.tsx';
import { errorText, useResource } from './resource.ts';
import { RouterProvider } from './router.tsx';
import { SessionContext, type Session } from './session.tsx';
import { Shell } from './Shell.tsx';

type AppProps = { socketFactory?: SocketFactory; player?: VoicePlayer };

function useSessionGeneration(auth: AuthState | null): number {
  const generation = useRef<{ auth: AuthState | null; value: number }>({ auth: null, value: 0 });
  if (auth?.user && generation.current.auth !== auth) generation.current = { auth, value: generation.current.value + 1 };
  return generation.current.value;
}

export function App({ socketFactory, player }: AppProps) {
  const auth = useResource(() => api.authState(), []);
  const info = useResource(() => api.appInfo().catch(() => ({ demo: null, consoleRequired: false })), []);
  const demo = info.data?.demo ?? null;
  const reload = auth.reload;
  const signOut = useCallback(async () => {
    await api.signOut();
    reload();
  }, [reload]);
  const generation = useSessionGeneration(auth.data);
  const session = useMemo<Session | null>(() => (auth.data?.user ? { user: auth.data.user, signOut, ended: reload } : null), [auth.data, signOut, reload]);

  if (auth.error) {
    return (
      <div className="auth">
        <div className="panel">
          <h1>The server did not answer</h1>
          <p className="lede">Check that GT7 Tutor is running on the computer, then reload this page.</p>
          <p className="sub">{errorText(auth.error)}</p>
        </div>
      </div>
    );
  }
  if (!auth.data) return null;
  if (!auth.data.hasUsers) return <FirstProfileView onSignedIn={reload} />;
  const liveOptions = { ...(socketFactory ? { socketFactory } : {}), ...(player ? { player } : {}) };
  return (
    <DemoContext.Provider value={demo}>
      {session ? (
        <SessionContext.Provider value={session}>
          <LiveProvider key={generation} {...liveOptions}>
            <RouterProvider>
              <Shell />
            </RouterProvider>
          </LiveProvider>
        </SessionContext.Provider>
      ) : (
        <SignInView onSignedIn={reload} />
      )}
    </DemoContext.Provider>
  );
}
