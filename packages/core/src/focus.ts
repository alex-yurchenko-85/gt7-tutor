import type { FindingKindName, Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG, type CoreConfig } from './config.ts';
import { cornerAt, type Corner } from './corners.ts';
import { focusClipKey, focusText } from './cue-text.ts';
import { comparableSize, type Finding, type Recurring } from './findings.ts';

export type Focus = { kind: FindingKindName; turn: number; text: string; clip: string | null };

export type BrakeReaction = { eventKey: string; reactionMs: number };

export type PlayedBrakeCue = { eventKey: string; clipStartMonoMs: number };

function mostFrequent(recurring: Recurring[]): Finding | null {
  if (recurring.length === 0) return null;
  return recurring.reduce((best, entry) =>
    entry.count > best.count || (entry.count === best.count && comparableSize(entry.medianSize, entry.unit) > comparableSize(best.medianSize, best.unit)) ? entry : best
  );
}

function largest(findings: Finding[]): Finding | null {
  if (findings.length === 0) return null;
  return findings.reduce((best, entry) => (comparableSize(entry.size, entry.unit) > comparableSize(best.size, best.unit) ? entry : best));
}

export function focusSentence(recurring: Recurring[], latest: Finding[], corners: Corner[]): Focus | null {
  const finding = mostFrequent(recurring) ?? largest(latest);
  const corner = finding ? cornerAt(corners, finding.sM) : null;
  if (!finding || !corner) return null;
  return { kind: finding.kind, turn: corner.number, text: focusText(finding.kind, corner.number), clip: focusClipKey(finding.kind, corner.number) };
}

function brakeOnsetsMs(samples: Sample[], onThreshold: number): number[] {
  return samples.flatMap((sample, index) => {
    const previous = samples[index - 1];
    const rising = sample.brake > onThreshold && (previous === undefined || previous.brake <= onThreshold);
    return rising ? [sample.receivedMonoMs] : [];
  });
}

function brakingAt(samples: Sample[], monoMs: number, onThreshold: number): boolean {
  const current = samples.filter(sample => sample.receivedMonoMs <= monoMs).at(-1);
  return current !== undefined && current.brake > onThreshold;
}

function brakeStartMs(samples: Sample[], onsets: number[], clipStartMonoMs: number, config: CoreConfig): number | null {
  const started = brakingAt(samples, clipStartMonoMs, config.brakeReaction.onThreshold)
    ? onsets.filter(onset => onset <= clipStartMonoMs).at(-1)
    : onsets.find(onset => onset > clipStartMonoMs);
  if (started === undefined || Math.abs(started - clipStartMonoMs) > config.brakeReaction.windowMs) return null;
  return started;
}

export function brakeReactions(samples: Sample[], cues: PlayedBrakeCue[], config: CoreConfig = DEFAULT_CONFIG): BrakeReaction[] {
  const onsets = brakeOnsetsMs(samples, config.brakeReaction.onThreshold);
  return cues.flatMap(cue => {
    const started = brakeStartMs(samples, onsets, cue.clipStartMonoMs, config);
    return started === null ? [] : [{ eventKey: cue.eventKey, reactionMs: started - cue.clipStartMonoMs }];
  });
}
