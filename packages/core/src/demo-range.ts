import type { Sample } from '@gt7/contracts';
import { continuityBreak } from './attempts.ts';
import { DEFAULT_CONFIG, type CoreConfig } from './config.ts';
import { GameTimerWatch, type GameTimerSession } from './game-timer.ts';
import { distance } from './geometry.ts';
import { Matcher, type Match } from './match.ts';
import type { ReferencePath } from './reference.ts';
import { median } from './statistics.ts';

export type RawRange = { first: number; last: number };

export type TimerRunRange = RawRange & { gameTimeMs: number };

export type DemoRangeCandidate = {
  ranges: RawRange[];
  sampleCount: number;
  timed: boolean;
  ambiguous: boolean;
  evidence: string[];
};

type Element = { sample: Sample; firstIndex: number; lastIndex: number };

type Piece = { a: number; b: number; length: number };

type Chain = { pieces: Piece[] };

type Span = { from: number; to: number };

type Ranked = {
  spans: Span[];
  sampleCount: number;
  followsCue: boolean;
  entersScene: boolean;
  moves: boolean;
  timed: boolean;
  evidence: string[];
};

type Tolerance = CoreConfig['demoRange'];

function samePhysicalState(a: Sample, b: Sample, tolerance: Tolerance): boolean {
  return (
    Math.abs(a.position.x - b.position.x) <= tolerance.positionToleranceM &&
    Math.abs(a.position.z - b.position.z) <= tolerance.positionToleranceM &&
    Math.abs(a.position.y - b.position.y) <= tolerance.positionToleranceM &&
    Math.abs(a.speedMps - b.speedMps) <= tolerance.speedToleranceMps &&
    Math.abs(a.throttle - b.throttle) <= tolerance.pedalTolerance &&
    Math.abs(a.brake - b.brake) <= tolerance.pedalTolerance &&
    a.gear === b.gear &&
    a.carId === b.carId
  );
}

function collapse(capture: Sample[], tolerance: Tolerance): Element[] {
  const elements: Element[] = [];
  capture.forEach((sample, index) => {
    const last = elements.at(-1);
    if (last && samePhysicalState(last.sample, sample, tolerance)) last.lastIndex = index;
    else elements.push({ sample, firstIndex: index, lastIndex: index });
  });
  return elements;
}

function commonPieces(a: Element[], b: Element[], tolerance: Tolerance): Piece[] {
  const pieces: Piece[] = [];
  let previous = new Int32Array(b.length + 1);
  let current = new Int32Array(b.length + 1);
  for (let i = 0; i < a.length; i++) {
    current.fill(0);
    for (let j = 0; j < b.length; j++) {
      if (!samePhysicalState(a[i]!.sample, b[j]!.sample, tolerance)) continue;
      const length = previous[j]! + 1;
      current[j + 1] = length;
      if (length < tolerance.minPieceSamples) continue;
      const continues = i + 1 < a.length && j + 1 < b.length && samePhysicalState(a[i + 1]!.sample, b[j + 1]!.sample, tolerance);
      if (!continues) pieces.push({ a: i - length + 1, b: j - length + 1, length });
    }
    [previous, current] = [current, previous];
  }
  return pieces.sort((x, y) => x.a - y.a);
}

function chainEnd(chain: Chain): Piece {
  return chain.pieces.at(-1)!;
}

type Pair = { a: Element[]; b: Element[] };

function continuous(elements: Element[], fromIndex: number, toIndex: number, config: CoreConfig): boolean {
  return continuityBreak(elements[fromIndex]!.sample, elements[toIndex]!.sample, config) === null;
}

function follows(chain: Chain, piece: Piece, pair: Pair, config: CoreConfig): boolean {
  const last = chainEnd(chain);
  const endA = last.a + last.length - 1;
  const endB = last.b + last.length - 1;
  const gapA = piece.a - endA - 1;
  const gapB = piece.b - endB - 1;
  const maxGap = config.demoRange.maxGapSamples;
  if (gapA < 0 || gapB < 0 || gapA > maxGap || gapB > maxGap) return false;
  return continuous(pair.a, endA, piece.a, config) && continuous(pair.b, endB, piece.b, config);
}

function chainPieces(pieces: Piece[], pair: Pair, config: CoreConfig): Chain[] {
  const tolerance = config.demoRange;
  const chains: Chain[] = [];
  for (const piece of pieces) {
    const chain = chains.find(candidate => follows(candidate, piece, pair, config));
    if (chain) chain.pieces.push(piece);
    else chains.push({ pieces: [piece] });
  }
  return chains.filter(chain => spanA(chain).to - spanA(chain).from + 1 >= tolerance.minRunSamples);
}

function spanA(chain: Chain): Span {
  const last = chainEnd(chain);
  return { from: chain.pieces[0]!.a, to: last.a + last.length - 1 };
}

function mapToB(chain: Chain, aIndex: number, side: 'from' | 'to'): number {
  const inside = chain.pieces.find(piece => aIndex >= piece.a && aIndex < piece.a + piece.length);
  if (inside) return inside.b + (aIndex - inside.a);
  if (side === 'from') {
    const next = chain.pieces.find(piece => piece.a > aIndex)!;
    return next.b;
  }
  const before = chain.pieces.filter(piece => piece.a + piece.length - 1 < aIndex).at(-1)!;
  return before.b + before.length - 1;
}

function intersect(chainSets: Chain[][], minRunSamples: number): Span[][] {
  const combinations: Span[][] = [];
  const walk = (level: number, span: Span, chosen: Chain[]): void => {
    if (level === chainSets.length) {
      const mapped = chosen.map(chain => ({ from: mapToB(chain, span.from, 'from'), to: mapToB(chain, span.to, 'to') }));
      combinations.push([span, ...mapped]);
      return;
    }
    for (const chain of chainSets[level]!) {
      const own = spanA(chain);
      const overlap = { from: Math.max(span.from, own.from), to: Math.min(span.to, own.to) };
      if (overlap.to - overlap.from + 1 >= minRunSamples) walk(level + 1, overlap, [...chosen, chain]);
    }
  };
  walk(0, { from: 0, to: Number.MAX_SAFE_INTEGER }, []);
  return combinations;
}

function round(value: number, digits: number): string {
  return value.toFixed(digits);
}

function travelled(capture: Sample[], first: number, last: number): number {
  let total = 0;
  for (let index = first + 1; index <= last; index++) total += distance(capture[index - 1]!.position, capture[index]!.position);
  return total;
}

function describe(
  captures: Sample[][],
  cues: (number | null)[],
  sampleSpans: Span[],
  config: CoreConfig
): Omit<Ranked, 'spans' | 'sampleCount' | 'timed'> {
  const evidence: string[] = [];
  let cueChecks = 0;
  let cueFailures = 0;
  let sceneFailures = 0;
  sampleSpans.forEach((span, index) => {
    const capture = captures[index]!;
    const first = capture[span.from]!;
    const label = `Capture ${index + 1}`;
    const cue = cues[index] ?? null;
    if (cue === null) {
      evidence.push(`${label}: START cue missing`);
    } else {
      cueChecks += 1;
      const afterMs = first.receivedMonoMs - cue;
      const inside = afterMs >= 0 && afterMs <= config.demoRange.cueWindowMs;
      if (!inside) cueFailures += 1;
      const window = inside ? '' : `, outside 0–${round(config.demoRange.cueWindowMs / 1000, 0)} s`;
      evidence.push(`${label}: starts ${round(afterMs / 1000, 2)} s after START${window}`);
    }
    const before = capture[span.from - 1];
    const broken = before ? continuityBreak(before, first, config) : null;
    if (before && broken) {
      evidence.push(`${label}: position jumps ${round(distance(before.position, first.position), 1)} m before the start`);
    } else {
      sceneFailures += 1;
      evidence.push(`${label}: no scene change before the start`);
    }
  });
  const movementM = travelled(captures[0]!, sampleSpans[0]!.from, sampleSpans[0]!.to);
  evidence.push(`Moves ${round(movementM, 1)} m`);
  if (captures.length < 3) evidence.push(`Only ${captures.length} captures: repeated background cannot be excluded`);
  return {
    followsCue: cueChecks > 0 && cueFailures === 0,
    entersScene: sceneFailures === 0,
    moves: movementM > config.demoRange.minMovementM,
    evidence
  };
}

function score(candidate: Ranked): number {
  return (candidate.followsCue ? 4 : 0) + (candidate.entersScene ? 2 : 0) + (candidate.moves ? 1 : 0);
}

function isEligible(candidate: Ranked): boolean {
  return candidate.followsCue && candidate.entersScene && candidate.moves && candidate.timed;
}

type TimerRun = { span: Span; gameTimeMs: number };

function timerRun(capture: Sample[], span: Span, session: GameTimerSession): TimerRun | null {
  const watch = new GameTimerWatch({ session });
  let startIndex: number | null = null;
  for (let index = span.from; index < capture.length; index++) {
    if (index > span.to && !watch.active) return null;
    const event = watch.step(capture[index]!);
    if (!event) continue;
    if (event.type === 'started') startIndex = index - 1;
    else if (event.type === 'finished' && startIndex !== null) {
      const finishIndex = capture.findIndex(sample => sample.rawIndex === event.rawIndex);
      return finishIndex <= span.to ? { span: { from: startIndex, to: finishIndex }, gameTimeMs: event.gameTimeMs } : null;
    } else startIndex = null;
  }
  return null;
}

export function cutToTimerRun(capture: Sample[], range: RawRange, session: GameTimerSession): TimerRunRange | null {
  const from = capture.findIndex(sample => sample.rawIndex >= range.first);
  const to = capture.findLastIndex(sample => sample.rawIndex <= range.last);
  if (from < 0 || to < from) return null;
  const run = timerRun(capture, { from, to }, session);
  if (!run) return null;
  return { first: capture[run.span.from]!.rawIndex, last: capture[run.span.to]!.rawIndex, gameTimeMs: run.gameTimeMs };
}

function cutToTimer(captures: Sample[][], candidate: Ranked): Ranked {
  const runs = candidate.spans.map((span, index) => timerRun(captures[index]!, span, 'demonstration'));
  const timerEvidence = runs.map((run, index) =>
    run ? `Capture ${index + 1}: timer runs ${round(run.gameTimeMs / 1000, 3)} s` : `Capture ${index + 1}: no complete timer run`
  );
  const evidence = [...candidate.evidence, ...timerEvidence];
  if (runs.some(run => run === null)) return { ...candidate, timed: false, evidence };
  const spans = runs.map(run => run!.span);
  return { ...candidate, spans, sampleCount: spans[0]!.to - spans[0]!.from + 1, timed: true, evidence };
}

function overlapsMostly(a: Span, b: Span): boolean {
  const shared = Math.min(a.to, b.to) - Math.max(a.from, b.from) + 1;
  return shared > (a.to - a.from + 1) / 2;
}

function withoutDuplicates(candidates: Ranked[]): Ranked[] {
  const kept: Ranked[] = [];
  for (const candidate of [...candidates].sort((x, y) => y.sampleCount - x.sampleCount)) {
    if (!kept.some(other => overlapsMostly(candidate.spans[0]!, other.spans[0]!))) kept.push(candidate);
  }
  return kept;
}

function sameSpan(a: Span, b: Span): boolean {
  return a.from === b.from && a.to === b.to;
}

function withoutEqualCuts(ranked: Ranked[]): Ranked[] {
  return ranked.filter((candidate, index) => !ranked.slice(0, index).some(better => sameSpan(better.spans[0]!, candidate.spans[0]!)));
}

export function findDemoRangeCandidates(
  captures: Sample[][],
  startCueMonoMs: (number | null)[],
  config: CoreConfig = DEFAULT_CONFIG
): DemoRangeCandidate[] {
  if (captures.length < 2) return [];
  const tolerance = config.demoRange;
  const elements = captures.map(capture => collapse(capture, tolerance));
  const chainSets = elements
    .slice(1)
    .map(other => chainPieces(commonPieces(elements[0]!, other, tolerance), { a: elements[0]!, b: other }, config));
  const ranked = intersect(chainSets, tolerance.minRunSamples).map(elementSpans => {
    const sampleSpans = elementSpans.map((span, index) => ({
      from: elements[index]![span.from]!.firstIndex,
      to: elements[index]![span.to]!.lastIndex
    }));
    return {
      spans: sampleSpans,
      sampleCount: sampleSpans[0]!.to - sampleSpans[0]!.from + 1,
      ...describe(captures, startCueMonoMs, sampleSpans, config),
      timed: false
    };
  });
  const cut = withoutDuplicates(ranked)
    .map(candidate => cutToTimer(captures, candidate))
    .sort(
    (x, y) => Number(y.timed) - Number(x.timed) || score(y) - score(x) || y.sampleCount - x.sampleCount || x.spans[0]!.from - y.spans[0]!.from
  );
  const unique = withoutEqualCuts(cut);
  const eligible = unique.filter(isEligible);
  const confirmable = captures.length >= 3 && eligible.length === 1 ? eligible[0] : null;
  return unique.map(candidate => ({
    ranges: candidate.spans.map((span, index) => ({
      first: captures[index]![span.from]!.rawIndex,
      last: captures[index]![span.to]!.rawIndex
    })),
    sampleCount: candidate.sampleCount,
    timed: candidate.timed,
    ambiguous: candidate !== confirmable,
    evidence: candidate.evidence
  }));
}

type ConfirmRun = { firstIndex: number; lastIndex: number; firstSM: number; lastSM: number; matches: Match[]; samples: Sample[] };

function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? Number.POSITIVE_INFINITY;
}

function followsReference(match: Match | null, sample: Sample, tolerance: Tolerance): match is Match {
  if (!match) return false;
  const speedLimit = 0.05 * match.reference.speedMps + 0.5;
  return (
    Math.abs(match.lateralM) <= tolerance.confirmMaxLateralM &&
    match.heightM <= tolerance.confirmMaxLateralM &&
    Math.abs(sample.speedMps - match.reference.speedMps) <= speedLimit
  );
}

function confirms(run: ConfirmRun, path: ReferencePath, config: CoreConfig): boolean {
  const tolerance = config.demoRange;
  const endTolerance = config.match.sectionEndToleranceM;
  if (run.firstSM > endTolerance || run.lastSM < path.lengthM - endTolerance) return false;
  const speedRatios = run.matches.map((match, index) =>
    Math.abs(run.samples[index]!.speedMps - match.reference.speedMps) / Math.max(1, match.reference.speedMps)
  );
  const throttle = run.matches.map((match, index) => Math.abs(run.samples[index]!.throttle - match.reference.throttle));
  const brake = run.matches.map((match, index) => Math.abs(run.samples[index]!.brake - match.reference.brake));
  return (
    median(speedRatios) <= tolerance.confirmMaxSpeedRatio &&
    percentile95(run.matches.map(match => Math.abs(match.lateralM))) <= tolerance.confirmMaxLateralP95M &&
    median(throttle) <= tolerance.confirmMaxMedianPedal &&
    median(brake) <= tolerance.confirmMaxMedianPedal
  );
}

export function matchesReference(capture: Sample[], path: ReferencePath, config: CoreConfig = DEFAULT_CONFIG): RawRange | null {
  const matcher = new Matcher(path, config);
  let run: ConfirmRun | null = null;
  const finish = (): RawRange | null => {
    if (!run || !confirms(run, path, config)) return null;
    return { first: capture[run.firstIndex]!.rawIndex, last: capture[run.lastIndex]!.rawIndex };
  };
  for (let index = 0; index < capture.length; index++) {
    const sample = capture[index]!;
    const match = matcher.step(sample);
    if (followsReference(match, sample, config.demoRange)) {
      run ??= { firstIndex: index, lastIndex: index, firstSM: match.sM, lastSM: match.sM, matches: [], samples: [] };
      run.lastIndex = index;
      run.lastSM = match.sM;
      run.matches.push(match);
      run.samples.push(sample);
      continue;
    }
    const confirmed = finish();
    if (confirmed) return confirmed;
    if (run) matcher.reset();
    run = null;
  }
  return finish();
}
