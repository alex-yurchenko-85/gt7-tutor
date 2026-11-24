import { FOCUS_PARTS, focusPhrase, type FindingKindName, type FocusPart, type Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG, type CoreConfig } from './config.ts';
import { focusClipKey } from './cue-text.ts';
import type { Finding } from './findings.ts';
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

function turnOrder(attempt: FocusAttempt): TurnLoss[] {
  return attempt.losses.filter(loss => loss.lostMs !== null).sort((a, b) => b.lostMs! - a.lostMs! || a.turn - b.turn);
}

function partOf(loss: TurnLoss, config: CoreConfig): FocusPart | null {
  const parts = FOCUS_PARTS.flatMap(part => {
    const partMs = loss.parts[part];
    return partMs === null || partMs === undefined ? [] : [{ part, partMs }];
  });
  const passing = parts.find(({ partMs }) => partMs > config.focus.partMinMs && partMs > config.focus.partMinShare * loss.lostMs!);
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

function countsFor(attempt: FocusAttempt, loss: TurnLoss, part: FocusPart, finding: Finding): boolean {
  if (rangeTurnOf(attempt.losses, finding.sM) !== loss.turn) return false;
  return finding.kind !== 'off-line' || partAt(loss, finding.sM) === part;
}

function causeOf(attempt: FocusAttempt, loss: TurnLoss, part: FocusPart): FindingKindName | null {
  const kinds = new Set(attempt.findings.filter(finding => countsFor(attempt, loss, part, finding)).map(finding => finding.kind));
  const cause = FOCUS_KIND_ORDER.find(kind => PART_KINDS[part].includes(kind) && kinds.has(kind));
  return cause ?? (kinds.has('off-line') ? 'off-line' : null);
}

export function focusFor(attempt: FocusAttempt, config: CoreConfig = DEFAULT_CONFIG): Focus | null {
  for (const loss of turnOrder(attempt)) {
    if (loss.lostMs! < config.focus.turnMinMs) continue;
    const part = partOf(loss, config);
    if (part === null) continue;
    const cause = causeOf(attempt, loss, part);
    return { turn: loss.turn, part, cause, clip: focusClipKey(focusPhrase(part, cause), loss.turn) };
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
