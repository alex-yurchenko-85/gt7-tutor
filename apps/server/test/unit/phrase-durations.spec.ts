import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { phraseDurations } from '../../src/training/phrase-durations.js';

const committedAudioDir = fileURLToPath(new URL('../../../../content/audio', import.meta.url));
const made: string[] = [];

function audioDirWith(manifests: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'gt7-audio-'));
  made.push(root);
  for (const [lang, manifest] of Object.entries(manifests)) {
    mkdirSync(join(root, lang), { recursive: true });
    writeFileSync(join(root, lang, 'manifest.json'), JSON.stringify(manifest));
  }
  return root;
}

describe('phrase durations', () => {
  afterEach(() => {
    for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('uses_the_english_clip_when_the_language_has_none', () => {
    expect(phraseDurations(committedAudioDir, 'en')('hard-brake')).toBe(766);
    expect(phraseDurations(committedAudioDir, 'ru')('hard-brake')).toBe(766);
  });

  it('prefers_the_clip_of_the_language', () => {
    const root = audioDirWith({ en: { clips: { 'hard-brake': { durationMs: 766 }, brake: { durationMs: 400 } } }, ru: { clips: { 'hard-brake': { durationMs: 900 } } } });
    const durationOf = phraseDurations(root, 'ru');
    expect(durationOf('hard-brake')).toBe(900);
    expect(durationOf('brake')).toBe(400);
  });

  it('estimates_a_clip_that_no_manifest_has', () => {
    const durationOf = phraseDurations(audioDirWith({}), 'en');
    expect(durationOf('hard-brake')).toBe(640);
  });
});
