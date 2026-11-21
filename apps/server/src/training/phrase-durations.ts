import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGLISH } from '@gt7/contracts';
import { estimatedPhraseMs } from '@gt7/core';

type Manifest = { clips?: Record<string, { durationMs?: number }> };

function durationsOf(audioDir: string, lang: string): Map<string, number> {
  const path = join(audioDir, lang, 'manifest.json');
  const manifest: Manifest = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Manifest) : {};
  return new Map(Object.entries(manifest.clips ?? {}).flatMap(([key, clip]) => (typeof clip.durationMs === 'number' ? [[key, clip.durationMs] as const] : [])));
}

export function phraseDurations(audioDir: string, lang: string): (clip: string) => number {
  const own = durationsOf(audioDir, lang);
  const english = lang === ENGLISH.lang ? own : durationsOf(audioDir, ENGLISH.lang);
  return clip => own.get(clip) ?? english.get(clip) ?? estimatedPhraseMs(ENGLISH, clip);
}
