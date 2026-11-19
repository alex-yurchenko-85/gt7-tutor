import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Sample } from '@gt7/contracts';
import { readSamples } from '@gt7/capture';
import {
  analyseReference,
  DEFAULT_CONFIG,
  DEFAULT_SIDE_CUE_DISTANCE_M,
  estimatedPhraseMs,
  cueText,
  replayCoach
} from '@gt7/core';

function sideDistanceOf(text: string): number | null {
  if (text === 'off') return null;
  const distanceM = Number(text);
  if (!Number.isFinite(distanceM) || distanceM <= 0) throw new Error('--side-distance must be a number of metres > 0 or off');
  return distanceM;
}

function readArguments() {
  const { values } = parseArgs({
    options: {
      attempt: { type: 'string' },
      reference: { type: 'string' },
      first: { type: 'string' },
      last: { type: 'string' },
      delay: { type: 'string', default: '60' },
      'side-distance': { type: 'string', default: String(DEFAULT_SIDE_CUE_DISTANCE_M) },
      out: { type: 'string' }
    }
  });
  const first = Number(values.first);
  const last = Number(values.last);
  const deviceDelayMs = Number(values.delay);
  if (!values.attempt || !values.reference || !Number.isInteger(first) || !Number.isInteger(last) || last <= first) {
    throw new Error(
      'Usage: pnpm evaluate-coach --attempt <fixture> --reference <fixture> --first <raw index> --last <raw index> [--delay <ms>] [--side-distance <m|off>] [--out <file>]'
    );
  }
  if (!Number.isFinite(deviceDelayMs) || deviceDelayMs < 0) throw new Error('--delay must be a number of milliseconds >= 0');
  const sideCueDistanceM = sideDistanceOf(values['side-distance']);
  return { attempt: values.attempt, reference: values.reference, first, last, deviceDelayMs, sideCueDistanceM, out: values.out ?? null };
}

function fixtureFile(name: string): string {
  const path = existsSync(name) ? name : resolve('fixtures', `${name}.ndjson`);
  if (!existsSync(path)) throw new Error(`No fixture or file named ${name}`);
  return path;
}

function samplesOf(name: string, range?: { first: number; last: number }): Promise<Sample[]> {
  return readSamples(fixtureFile(name), range);
}

async function main() {
  const options = readArguments();
  const analysis = analyseReference(await samplesOf(options.reference, options), 'flying', DEFAULT_CONFIG);
  const { path, events } = analysis;
  const trace = replayCoach(await samplesOf(options.attempt), analysis, DEFAULT_CONFIG, {
    deviceDelayMs: options.deviceDelayMs,
    phraseMs: estimatedPhraseMs,
    mutedKeys: new Set(),
    speakTargets: true,
    offsetsMs: new Map(),
    sideCueDistanceM: options.sideCueDistanceM
  });
  const report = {
    reference: { fixture: options.reference, first: options.first, last: options.last, lengthM: path.lengthM },
    attempt: options.attempt,
    deviceDelayMs: options.deviceDelayMs,
    phraseDurations: 'estimatedPhraseMs',
    speakTargets: true,
    sideCueDistanceM: options.sideCueDistanceM,
    events: events.map(event => ({ ...event, text: cueText(event.voice) })),
    trace
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    mkdirSync(dirname(resolve(options.out)), { recursive: true });
    writeFileSync(resolve(options.out), text);
  }
  process.stdout.write(text);
}

await main();
