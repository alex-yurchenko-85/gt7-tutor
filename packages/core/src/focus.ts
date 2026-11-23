import { FOCUS_PARTS, focusPhrase, type FindingKindName, type FocusPart, type Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG, type CoreConfig } from './config.ts';
import { focusClipKey } from './cue-text.ts';
import type { Finding } from './findings.ts';
import { median } from './statistics.ts';
import type { TurnLoss } from './turns.ts';

export type Focus = { turn: number; part: FocusPart; cause: FindingKindName | null; clip: string | null };

export type FocusAttempt = { findings: Finding[]; losses: TurnLoss[] };

export type BrakeReaction = { eventKey: string; reactionMs: number };

export type PlayedBrakeCue = { eventKey: string; clipStartMonoMs: number };

export const FOCUS_KIND_ORDER: readonly FindingKindName[] = ['brake-early', 'brake-late', 'low-point-early', 'low-point-late', 'slow-corner', 'wide-apex', 'throttle-late', 'off-line'];

export const PART_KINDS: Record<FocusPart, readonly FindingKindName[]> = {
  approach: ['brake-early', 'brake-late'],
  entry: ['brake-late', 'low-point-early', 'low-point-late', 'slow-corner', 'wide-apex'],
  exit: ['brake-late', 'throttle-late']
};

type TurnMedian = { turn: number; medianMs: number };

function medianOf(values: (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => value !== null && value !== undefined);
  return known.length === 0 ? null : median(known);
}

function turnMedians(window: FocusAttempt[]): TurnMedian[] {
  const turns = [...new Set(window.flatMap(attempt => attempt.losses.map(loss => loss.turn)))];
  return turns
    .flatMap(turn => {
      const medianMs = medianOf(window.map(attempt => attempt.losses.find(loss => loss.turn === turn)?.lostMs));
      return medianMs === null ? [] : [{ turn, medianMs }];
    })
    .sort((a, b) => b.medianMs - a.medianMs || a.turn - b.turn);
}

function partOf(window: FocusAttempt[], { turn, medianMs }: TurnMedian, config: CoreConfig): FocusPart | null {
  const parts = FOCUS_PARTS.flatMap(part => {
    const partMs = medianOf(window.map(attempt => attempt.losses.find(loss => loss.turn === turn)?.parts[part]));
    return partMs === null ? [] : [{ part, partMs }];
  });
  const passing = parts.find(({ partMs }) => partMs > config.focus.partMinMs && partMs > config.focus.partMinShare * medianMs);
  const [largest] = parts.filter(({ partMs }) => partMs > 0).sort((a, b) => b.partMs - a.partMs);
  return (passing ?? largest)?.part ?? null;
}

function rangeTurnOf(losses: TurnLoss[], sM: number): number | null {
  return (losses.findLast(loss => loss.fromSM <= sM) ?? losses[0])?.turn ?? null;
}

function partAt(loss: TurnLoss, sM: number): FocusPart {
  if (sM < loss.entrySM) return 'approach';
  return sM < loss.exitSM ? 'entry' : 'exit';
}

function countsFor(attempt: FocusAttempt, turn: number, part: FocusPart, finding: Finding): boolean {
  if (rangeTurnOf(attempt.losses, finding.sM) !== turn) return false;
  if (finding.kind !== 'off-line') return true;
  const loss = attempt.losses.find(item => item.turn === turn)!;
  return partAt(loss, finding.sM) === part;
}

function causeOf(window: FocusAttempt[], turn: number, part: FocusPart): FindingKindName | null {
  const perAttempt = window.map(attempt => new Set(attempt.findings.filter(finding => countsFor(attempt, turn, part, finding)).map(finding => finding.kind)));
  const attempts = (kind: FindingKindName) => perAttempt.filter(kinds => kinds.has(kind)).length;
  const inHalf = (kind: FindingKindName) => attempts(kind) * 2 >= window.length;
  const [best] = FOCUS_KIND_ORDER.filter(kind => PART_KINDS[part].includes(kind) && inHalf(kind)).sort((a, b) => attempts(b) - attempts(a));
  return best ?? (inHalf('off-line') ? 'off-line' : null);
}

export function focusFor(latestFirst: FocusAttempt[], config: CoreConfig = DEFAULT_CONFIG): Focus | null {
  const window = latestFirst.slice(0, config.focus.attempts);
  for (const turnMedian of turnMedians(window)) {
    if (turnMedian.medianMs < config.focus.turnMinMs) continue;
    const part = partOf(window, turnMedian, config);
    if (part === null) continue;
    const cause = causeOf(window, turnMedian.turn, part);
    return { turn: turnMedian.turn, part, cause, clip: focusClipKey(focusPhrase(part, cause), turnMedian.turn) };
  }
  return null;
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
