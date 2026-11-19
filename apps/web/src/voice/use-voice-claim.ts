import { useState } from 'react';
import { useLive } from '../api/live.tsx';
import { errorText } from '../app/resource.ts';
import { COUNTDOWN_CLIPS } from './clips.ts';
import { setWantsVoice } from './device.ts';
import { VOICE_CHECK_CLIP } from './VoicePlayer.ts';

export type VoiceClaim = { here: boolean; ready: boolean; busy: boolean; problem: string | null; claim(): Promise<void>; release(): void };

export function useVoiceClaim(): VoiceClaim {
  const { state, send, player, deviceId } = useLive();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const here = state?.voiceDeviceId === deviceId;

  const claim = async () => {
    setProblem(null);
    setBusy(true);
    try {
      await player.unlock();
      await player.preload([VOICE_CHECK_CLIP, ...COUNTDOWN_CLIPS]);
    } catch (error) {
      setProblem(`The browser did not start audio: ${errorText(error)}`);
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
