import { useCallback, useEffect, useRef, useState } from 'react';
import type { CuePreview, PreviewCue } from '@gt7/contracts';
import type { VoicePlayer } from '../../voice/VoicePlayer.ts';
import { cuesDue } from './preview-timeline.ts';

const TICK_MS = 50;
const SPEAKING_MS = 1500;

export type CuePreviewRun = {
  preview: CuePreview | null;
  startedAt: number;
  speaking: PreviewCue | null;
  start(preview: CuePreview): void;
  stop(): void;
};

type Run = { preview: CuePreview; startedAt: number; speaking: PreviewCue | null };

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
        const before = speaking;
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
        if (speaking !== before) setRun({ preview, startedAt, speaking });
      }, TICK_MS);
      setRun({ preview, startedAt, speaking: null });
    },
    [clear, player]
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current === null) return;
      clear();
      player.stop();
    };
  }, [clear, player]);

  return { preview: run?.preview ?? null, startedAt: run?.startedAt ?? 0, speaking: run?.speaking ?? null, start, stop };
}

export function usePreviewElapsed(run: CuePreviewRun): number {
  const [now, setNow] = useState(() => performance.now());
  const active = run.preview !== null;
  useEffect(() => {
    if (!active) return;
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active, run.startedAt]);
  return active ? Math.max(0, now - run.startedAt) : 0;
}
