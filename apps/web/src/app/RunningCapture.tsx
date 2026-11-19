import { useState } from 'react';
import { api } from '../api/client.ts';
import { useLiveState } from '../api/live.tsx';
import { errorText } from './resource.ts';
import { useRouter } from './router.tsx';

export function RunningCapture() {
  const capturing = useLiveState(({ state }) => state?.mode === 'capturing');
  const { route } = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!capturing || route.name === 'record') return null;

  const stop = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const running = (await api.captures()).find(capture => capture.active);
      if (running) await api.stopCapture(running.id);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="running-capture" role="status">
      <span>A recording is running. While it runs, you cannot record, start an attempt or check reception.</span>
      <button className="btn inline" type="button" onClick={() => void stop()} disabled={busy}>
        Stop recording
      </button>
      {problem ? <span className="error">{problem}</span> : null}
    </div>
  );
}
