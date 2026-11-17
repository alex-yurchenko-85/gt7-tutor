import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allClipKeys } from '../src/cue-text.ts';

const audioDir = fileURLToPath(new URL('../../../audio/', import.meta.url));

type ClipEntry = { file: string; durationMs: number };
type Manifest = { clips: Record<string, ClipEntry> };

function readManifest(): Manifest {
  return JSON.parse(readFileSync(`${audioDir}manifest.json`, 'utf8')) as Manifest;
}

function clipPath(entry: ClipEntry): string {
  return `${audioDir}${entry.file}`;
}

type WavFormat = { channels: number; sampleRate: number; bitsPerSample: number; dataBytes: number };

function readWavFormat(path: string): WavFormat {
  const bytes = readFileSync(path);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path} is not WAVE`);
  let offset = 12;
  let format: Omit<WavFormat, 'dataBytes'> | null = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      format = {
        channels: bytes.readUInt16LE(offset + 10),
        sampleRate: bytes.readUInt32LE(offset + 12),
        bitsPerSample: bytes.readUInt16LE(offset + 22)
      };
    }
    if (id === 'data' && format) return { ...format, dataBytes: size };
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${path} has no data chunk`);
}

function wavDurationMs(format: WavFormat): number {
  return (format.dataBytes / (format.channels * (format.bitsPerSample / 8)) / format.sampleRate) * 1000;
}

describe('audio manifest', () => {
  it('manifest_covers_every_clip_key', () => {
    expect(Object.keys(readManifest().clips).sort()).toEqual(allClipKeys().sort());
  });

  it('every_clip_file_exists', () => {
    const missing = Object.entries(readManifest().clips).filter(([, entry]) => !entry.file || !existsSync(clipPath(entry)));
    expect(missing.map(([key]) => key)).toEqual([]);
  });

  it('every_clip_is_mono_pcm_with_the_listed_duration', () => {
    for (const entry of Object.values(readManifest().clips)) {
      const format = readWavFormat(clipPath(entry));
      expect(format.channels).toBe(1);
      expect(format.bitsPerSample).toBe(16);
      expect(Math.abs(wavDurationMs(format) - entry.durationMs)).toBeLessThanOrEqual(1);
    }
  });

  it('no_action_clip_longer_than_1800_ms', () => {
    const long = Object.entries(readManifest().clips).filter(([key, entry]) => !key.startsWith('focus-') && entry.durationMs > 1800);
    expect(long.map(([key]) => key)).toEqual([]);
  });

  it('no_focus_clip_longer_than_2600_ms', () => {
    const long = Object.entries(readManifest().clips).filter(([key, entry]) => key.startsWith('focus-') && entry.durationMs > 2600);
    expect(long.map(([key]) => key)).toEqual([]);
  });

  it('no_clip_outside_the_key_list', () => {
    const keys = new Set(allClipKeys());
    const files = readdirSync(`${audioDir}clips`).filter(file => file.endsWith('.wav'));
    expect(files.filter(file => !keys.has(file.slice(0, -'.wav'.length)))).toEqual([]);
  });
});
