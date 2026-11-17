import type { Sample } from '@gt7/contracts';
import { cornerAt, type Corner } from './corners.ts';
import { focusClipKey, focusText, type FocusKind } from './cue-text.ts';
import type { Finding, Recurring } from './findings.ts';

export type Focus = { kind: FocusKind; turn: number; text: string; clip: string | null };

export type BrakeReaction = { eventKey: string; reactionMs: number };

export type PlayedBrakeCue = { eventKey: string; clipStartMonoMs: number };

export const BRAKE_REACTION_ON = 0.1;
export const BRAKE_REACTION_WINDOW_MS = 3000;

function mostFrequent(recurring: Recurring[]): Finding | null {
  if (recurring.length === 0) return null;
  return recurring.reduce((best, entry) =>
    entry.count > best.count || (entry.count === best.count && entry.medianSize > best.medianSize) ? entry : best
  );
}

function largest(findings: Finding[]): Finding | null {
  if (findings.length === 0) return null;
  return findings.reduce((best, entry) => (entry.size > best.size ? entry : best));
}

export function focusSentence(recurring: Recurring[], latest: Finding[], corners: Corner[]): Focus | null {
  const finding = mostFrequent(recurring) ?? largest(latest);
  const corner = finding ? cornerAt(corners, finding.sM) : null;
  if (!finding || !corner) return null;
  return { kind: finding.kind, turn: corner.number, text: focusText(finding.kind, corner.number), clip: focusClipKey(finding.kind, corner.number) };
}

function brakeOnsetsMs(samples: Sample[]): number[] {
  return samples.flatMap((sample, index) => {
    const previous = samples[index - 1];
    const rising = sample.brake > BRAKE_REACTION_ON && (previous === undefined || previous.brake <= BRAKE_REACTION_ON);
    return rising ? [sample.receivedMonoMs] : [];
  });
}

function brakingAt(samples: Sample[], monoMs: number): boolean {
  const current = samples.filter(sample => sample.receivedMonoMs <= monoMs).at(-1);
  return current !== undefined && current.brake > BRAKE_REACTION_ON;
}

function brakeStartMs(samples: Sample[], onsets: number[], clipStartMonoMs: number): number | null {
  const started = brakingAt(samples, clipStartMonoMs)
    ? onsets.filter(onset => onset <= clipStartMonoMs).at(-1)
    : onsets.find(onset => onset > clipStartMonoMs);
  if (started === undefined || Math.abs(started - clipStartMonoMs) > BRAKE_REACTION_WINDOW_MS) return null;
  return started;
}

export function brakeReactions(samples: Sample[], cues: PlayedBrakeCue[]): BrakeReaction[] {
  const onsets = brakeOnsetsMs(samples);
  return cues.flatMap(cue => {
    const started = brakeStartMs(samples, onsets, cue.clipStartMonoMs);
    return started === null ? [] : [{ eventKey: cue.eventKey, reactionMs: started - cue.clipStartMonoMs }];
  });
}
