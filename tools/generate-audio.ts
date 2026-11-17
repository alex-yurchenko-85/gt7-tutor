import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allClipKeys, clipText } from '@gt7/core';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const VOICE = 'af_heart';
const SPEED = 1.1;
const PEAK = 0.89;
const ONSET_RATIO = 0.01;
const LEAD_MS = 15;
const TAIL_MS = 40;
const FADE_OUT_MS = 20;

type Speech = { audio: Float32Array; sampling_rate: number };
type Synthesizer = { generate(text: string, options: { voice: string; speed: number }): Promise<Speech> };
type KokoroModule = {
  KokoroTTS: { from_pretrained(id: string, options: { dtype: 'fp32'; device: 'cpu' }): Promise<Synthesizer> };
};

const toolDir = resolve('tools/audio');
const audioDir = resolve('audio');
const clipDir = join(audioDir, 'clips');

async function loadKokoro(): Promise<KokoroModule> {
  if (!existsSync(join(toolDir, 'node_modules'))) {
    throw new Error('Install the speech tool first: pnpm --dir tools/audio install');
  }
  const entry = createRequire(join(toolDir, 'package.json')).resolve('kokoro-js');
  return (await import(pathToFileURL(entry).href.replace(/kokoro\.cjs$/, 'kokoro.js'))) as KokoroModule;
}

function peakOf(samples: Float32Array): number {
  return samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
}

function audibleBounds(samples: Float32Array, threshold: number): { first: number; last: number } {
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]!) < threshold) first++;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]!) < threshold) last--;
  return { first, last };
}

function prepareClip(speech: Speech): Float32Array {
  const rate = speech.sampling_rate;
  const peak = peakOf(speech.audio);
  if (peak === 0) throw new Error('the speech tool returned silence');
  const { first, last } = audibleBounds(speech.audio, peak * ONSET_RATIO);
  const start = Math.max(0, first - Math.round((LEAD_MS / 1000) * rate));
  const end = Math.min(speech.audio.length, last + 1 + Math.round((TAIL_MS / 1000) * rate));
  const clip = speech.audio.slice(start, end).map(value => (value / peak) * PEAK);
  const fade = Math.min(clip.length, Math.round((FADE_OUT_MS / 1000) * rate));
  for (let index = 0; index < fade; index++) clip[clip.length - 1 - index]! *= index / fade;
  return clip;
}

function encodeWav(samples: Float32Array, rate: number): Buffer {
  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  samples.forEach((value, index) => {
    const clamped = Math.max(-1, Math.min(1, value));
    wav.writeInt16LE(Math.round(clamped * 32767), 44 + index * 2);
  });
  return wav;
}

function removeStaleClips(keep: Set<string>): void {
  for (const file of readdirSync(clipDir)) {
    if (file.endsWith('.wav') && !keep.has(file)) rmSync(join(clipDir, file));
  }
}

async function main(): Promise<void> {
  const { KokoroTTS } = await loadKokoro();
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'fp32', device: 'cpu' });
  mkdirSync(clipDir, { recursive: true });
  const clips: Record<string, { file: string; durationMs: number }> = {};
  for (const key of allClipKeys()) {
    const text = clipText(key);
    const speech = await tts.generate(text, { voice: VOICE, speed: SPEED });
    const clip = prepareClip(speech);
    const file = `clips/${key}.wav`;
    writeFileSync(join(audioDir, file), encodeWav(clip, speech.sampling_rate));
    const durationMs = Math.round((clip.length / speech.sampling_rate) * 1000);
    clips[key] = { file, durationMs };
    console.log(`${key.padEnd(18)} ${String(durationMs).padStart(5)} ms  ${text}`);
  }
  removeStaleClips(new Set(Object.values(clips).map(clip => clip.file.slice('clips/'.length))));
  const manifest = { schemaVersion: 1, voice: { model: MODEL_ID, voice: VOICE, speed: SPEED }, clips };
  writeFileSync(join(audioDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const longest = Object.entries(clips).reduce((a, b) => (b[1].durationMs > a[1].durationMs ? b : a));
  console.log(`${Object.keys(clips).length} clips, longest ${longest[0]} ${longest[1].durationMs} ms`);
}

await main();
