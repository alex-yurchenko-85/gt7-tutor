import { useCallback, useEffect, useRef, useState } from 'react';
import type { CuePreview, PreviewCue } from '@gt7/contracts';
import type { VoicePlayer } from '../../voice/VoicePlayer.ts';
import { cuesDue } from './preview-timeline.ts';

const TICK_MS = 50;
const SPEAKING_MS = 1500;

type Run = { preview: CuePreview; elapsedMs: number; speaking: PreviewCue | null };

export type CuePreviewRun = {
  running: boolean;
  preview: CuePreview | null;
  elapsedMs: number;
  speaking: PreviewCue | null;
  start(preview: CuePreview): void;
  stop(): void;
};

export function useCuePreviewRun(player: VoicePlayer): CuePreviewRun {
  const [run, setRun] = useState<Run | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const clear = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const stop = useCallback(() => {
    clear();
    player.stop();
    setRun(null);
  }, [clear, player]);

  const start = useCallback(
    (preview: CuePreview) => {
      if (!mounted.current) return;
      clear();
      player.stop();
      const startedAt = performance.now();
      let lastMs = -Infinity;
      let speaking: PreviewCue | null = null;
      timer.current = setInterval(() => {
        const elapsedMs = performance.now() - startedAt;
        for (const cue of cuesDue(preview, lastMs, elapsedMs)) {
          speaking = cue;
          player.playLoaded(cue.clip, ...(cue.followClip ? [cue.followClip] : []));
        }
        lastMs = elapsedMs;
        if (speaking && elapsedMs - speaking.atMs > SPEAKING_MS) speaking = null;
        if (elapsedMs >= preview.timeMs) {
          clear();
          setRun(null);
          return;
        }
        setRun({ preview, elapsedMs, speaking });
      }, TICK_MS);
      setRun({ preview, elapsedMs: 0, speaking: null });
    },
    [clear, player]
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (timer.current === null) return;
      clear();
      player.stop();
    },
    [clear, player]
  );

  return { running: run !== null, preview: run?.preview ?? null, elapsedMs: run?.elapsedMs ?? 0, speaking: run?.speaking ?? null, start, stop };
}
