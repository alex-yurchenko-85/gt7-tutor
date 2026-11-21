import { useState } from 'react';
import { useLiveConnection, useLiveState } from '../api/live.tsx';
import { errorText } from '../app/resource.ts';
import { SYSTEM_CLIPS } from './clips.ts';
import { setWantsVoice } from './device.ts';
import { t } from '../app/i18n.ts';

export type VoiceClaim = { here: boolean; ready: boolean; busy: boolean; problem: string | null; claim(): Promise<void>; release(): void };

export function useVoiceClaim(): VoiceClaim {
  const { send, player, deviceId } = useLiveConnection();
  const { state } = useLiveState(snapshot => snapshot);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const here = state?.voiceDeviceId === deviceId;

  const claim = async () => {
    setProblem(null);
    setBusy(true);
    try {
      await player.unlock();
      await player.preload(SYSTEM_CLIPS);
    } catch (error) {
      setProblem(t('app.voice.audio-failed', { reason: errorText(error) }));
      return;
    } finally {
      setBusy(false);
    }
    setWantsVoice(true);
    send({ type: 'claim-voice', deviceId, ready: player.ready });
  };

  const release = () => {
    setWantsVoice(false);
    send({ type: 'release-voice' });
  };

  return { here, ready: here && state?.voiceReady === true, busy, problem, claim, release };
}
