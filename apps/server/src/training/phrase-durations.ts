import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimatedPhraseMs } from '@gt7/core';

type Manifest = { clips?: Record<string, { durationMs?: number }> };

export function phraseDurations(audioDir: string): (clip: string) => number {
  const path = join(audioDir, 'manifest.json');
  const manifest: Manifest = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Manifest) : {};
  const durations = new Map(Object.entries(manifest.clips ?? {}).map(([key, clip]) => [key, clip.durationMs]));
  return clip => durations.get(clip) ?? estimatedPhraseMs(clip);
}
