import type { Sample } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';
import type { Corner } from './corners.ts';
import { Matcher } from './match.ts';
import { NOMINAL_PACKET_MS } from './packet-clock.ts';
import type { RaceAnalysis } from './race-analysis.ts';
import { lapOf, raceCompareConfig, referenceOf } from './race-compare.ts';
import { drivenLap, fastestLap, type LapFacts } from './race-laps.ts';
import type { ReferencePath } from './reference.ts';
import { median } from './statistics.ts';
import { turnZones, type TurnZone } from './turns.ts';

export type GoldenSector = {
  turn: number | null;
  fromM: number;
  toM: number;
  lap: number;
  ms: number;
  bestLap: number;
  bestMs: number;
  medianMs: number;
  spreadMs: number;
  cleanLaps: number;
  bestJoins: boolean;
  slipstream: boolean;
};

export type GoldenExclusion = { lap: number; reason: 'first' | 'pit' | 'open' };

export type GoldenLap =
  | { state: 'ok'; bestLap: number; bestMs: number; goldenMs: number; sourceLaps: number[]; cleanLaps: number[]; sectors: GoldenSector[] }
  | { state: 'too-few'; cleanLaps: number[]; excluded: GoldenExclusion[] }
  | { state: 'gap'; cleanLaps: number[]; turn: number | null }
  | { state: 'no-chain'; cleanLaps: number[] };

type Point = { sM: number; tMs: number; v: number; sideM: number; position: number };

type Edge = { tMs: number; v: number; sideM: number };

type Trace = { lap: LapFacts; points: Point[]; lapMs: number; endV: number | null };

type Cell = { tMs: number; start: Edge; end: Edge; off: boolean };

type Chain = { ms: number; laps: number[] };

const JUMP_M = 50;
const NARROW_M = 4;
const MIN_STRAIGHT_M = 100;
const LIMIT_EPSILON = 1e-9;

function packetTimes(samples: Sample[]): number[] {
  const times = [0];
  for (let index = 1; index < samples.length; index++) {
    const before = samples[index - 1]!;
    const sample = samples[index]!;
    const still = sample.position.x === before.position.x && sample.position.y === before.position.y && sample.position.z === before.position.z;
    const steps = sample.paused || before.paused || still ? 0 : (sample.packetId - before.packetId) >>> 0;
    times.push(times[index - 1]! + steps * NOMINAL_PACKET_MS);
  }
  return times;
}

function traceOf(samples: Sample[], lap: LapFacts, analysis: RaceAnalysis, path: ReferencePath, config: CoreConfig): Trace {
  const own = drivenLap(samples, lap, analysis.pitStops, config).samples;
  const end = samples.find(sample => sample.rawIndex > lap.range.last && sample.playerSession && sample.lap === lap.number + 1);
  const times = packetTimes(end ? [...own, end] : own);
  const matcher = new Matcher(path, config, 0);
  const points: Point[] = [];
  own.forEach((sample, index) => {
    if (sample.paused || sample.loading) return;
    const match = matcher.step(sample);
    if (match === null) return;
    points.push({ sM: match.sM, tMs: times[index]!, v: sample.speedMps, sideM: match.lateralM, position: sample.racePosition });
  });
  if (points.length > 0 && points[0]!.sM > path.lengthM / 2) points[0] = { ...points[0]!, sM: 0 };
  return { lap, points, lapMs: times.at(-1)!, endV: end?.speedMps ?? null };
}

function firstAbove(sorted: number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]! > value) high = middle;
    else low = middle + 1;
  }
  return low;
}

function crossings(points: Point[], at: number[]): (Edge | null)[] {
  const found: (Edge | null)[] = at.map(() => null);
  let open = at.length;
  for (let index = 1; index < points.length && open > 0; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    if (!(a.sM < b.sM) || b.sM - a.sM >= JUMP_M) continue;
    for (let k = firstAbove(at, a.sM); k < at.length && at[k]! <= b.sM; k++) {
      if (found[k] !== null) continue;
      const u = (at[k]! - a.sM) / (b.sM - a.sM);
      found[k] = { tMs: a.tMs + (b.tMs - a.tMs) * u, v: a.v + (b.v - a.v) * u, sideM: a.sideM + (b.sideM - a.sideM) * u };
      open--;
    }
  }
  return found;
}

function deviation(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function boundaryOf(before: Corner, after: Corner, zoneEndSM: number, traces: Trace[]): number {
  let fromM = zoneEndSM;
  let toM = after.zoneStartSM;
  if (toM - fromM < NARROW_M) {
    fromM = before.apexSM;
    toM = after.apexSM;
  }
  const grid: number[] = [];
  for (let sM = Math.ceil(fromM); sM <= toM; sM++) grid.push(sM);
  const values = traces.map(trace => crossings(trace.points, grid));
  let best = (fromM + toM) / 2;
  let lowest = Number.POSITIVE_INFINITY;
  grid.forEach((sM, index) => {
    const speeds = values.flatMap(row => (row[index] ? [row[index]!.v] : []));
    if (speeds.length < traces.length) return;
    const spread = deviation(speeds);
    if (spread < lowest) {
      lowest = spread;
      best = sM;
    }
  });
  return best;
}

function edgesOf(corners: Corner[], zones: TurnZone[], lengthM: number, traces: Trace[]): number[] {
  const inner = corners.slice(0, -1).map((corner, index) => boundaryOf(corner, corners[index + 1]!, zones[index]!.toSM, traces));
  return [0, ...inner, lengthM];
}

function cellsOf(traces: Trace[], edges: number[], analysis: RaceAnalysis): (Cell | null)[][] {
  const count = edges.length - 1;
  const byLap = new Map(traces.map(trace => [trace.lap.number, trace]));
  const rows: (Cell | null)[][] = Array.from({ length: count }, () => []);
  for (const trace of traces) {
    const inner = crossings(trace.points, edges.slice(1, -1));
    const first = trace.points[0];
    const last = trace.points.at(-1);
    const next = byLap.get(trace.lap.number + 1)?.points[0];
    for (let k = 0; k < count; k++) {
      const start = k === 0 ? (first ? { tMs: 0, v: first.v, sideM: first.sideM } : null) : inner[k - 1]!;
      const end = k === count - 1 ? (last ? { tMs: trace.lapMs, v: next?.v ?? trace.endV ?? last.v, sideM: next?.sideM ?? last.sideM } : null) : inner[k]!;
      const off = analysis.offTrack.some(moment => moment.lap === trace.lap.number && moment.sM !== null && moment.sM >= edges[k]! && (moment.sM < edges[k + 1]! || k === count - 1));
      rows[k]!.push(start && end ? { tMs: end.tMs - start.tMs, start, end, off } : null);
    }
  }
  return rows;
}

function joins(end: Edge, start: Edge, config: CoreConfig): boolean {
  return Math.abs(end.v - start.v) <= config.race.goldenJoinMps + LIMIT_EPSILON && Math.abs(end.sideM - start.sideM) <= config.race.goldenJoinSideM + LIMIT_EPSILON;
}

function chainFrom(start: number, cells: Cell[][], usable: boolean[][], fits: boolean[][][], config: CoreConfig): Chain | null {
  const count = cells.length;
  const laps = cells[0]!.length;
  let cost = Array.from({ length: laps }, (_, lap) => (lap === start && usable[0]![lap] ? cells[0]![lap]!.tMs : Number.POSITIVE_INFINITY));
  const back: number[][] = [];
  for (let k = 1; k < count; k++) {
    const next = Array<number>(laps).fill(Number.POSITIVE_INFINITY);
    const from = Array<number>(laps).fill(-1);
    for (let b = 0; b < laps; b++) {
      if (!usable[k]![b]) continue;
      for (let a = 0; a < laps; a++) {
        if (!Number.isFinite(cost[a]!) || !fits[k]![a]![b]) continue;
        const total = cost[a]! + cells[k]![b]!.tMs;
        if (total < next[b]!) {
          next[b] = total;
          from[b] = a;
        }
      }
    }
    back.push(from);
    cost = next;
  }
  let best: Chain | null = null;
  for (let lap = 0; lap < laps; lap++) {
    if (!Number.isFinite(cost[lap]!)) continue;
    if (lap !== start && !joins(cells[count - 1]![lap]!.end, cells[0]![start]!.start, config)) continue;
    if (best !== null && !(cost[lap]! < best.ms)) continue;
    const picked = [lap];
    for (let k = count - 2; k >= 0; k--) picked.unshift(back[k]![picked[0]!]!);
    best = { ms: cost[lap]!, laps: picked };
  }
  return best;
}

function joinTable(cells: Cell[][], config: CoreConfig): boolean[][][] {
  return cells.map((row, k) => (k === 0 ? [] : cells[k - 1]!.map((before, a) => row.map((after, b) => a === b || joins(before.end, after.start, config)))));
}

function chainOf(cells: Cell[][], usable: boolean[][], config: CoreConfig): Chain | null {
  const fits = joinTable(cells, config);
  let best: Chain | null = null;
  for (let start = 0; start < cells[0]!.length; start++) {
    const chain = chainFrom(start, cells, usable, fits, config);
    if (chain !== null && (best === null || chain.ms < best.ms)) best = chain;
  }
  return best;
}

function slipstreams(corners: Corner[], zonesEnd: number[], edges: number[], traces: Trace[], config: CoreConfig): Set<string> {
  const flagged = new Set<string>();
  for (let index = 0; index + 1 < corners.length; index++) {
    const fromM = zonesEnd[index]!;
    const toM = corners[index + 1]!.zoneStartSM;
    if (toM - fromM < MIN_STRAIGHT_M) continue;
    const tops = traces.flatMap(trace => {
      let top: Point | null = null;
      for (const point of trace.points) if (point.sM >= fromM && point.sM <= toM && (top === null || point.v > top.v)) top = point;
      return top ? [{ lap: trace.lap.number, top }] : [];
    });
    const middle = median(tops.map(({ top }) => top.v));
    for (const { lap, top } of tops) {
      if (top.v - middle <= config.race.goldenSlipstreamMps || top.position === 1) continue;
      const sector = edges.findIndex((edge, k) => k < edges.length - 1 && top.sM >= edge && top.sM < edges[k + 1]!);
      flagged.add(`${sector}:${lap}`);
    }
  }
  return flagged;
}

function exclusionOf(lap: LapFacts, analysis: RaceAnalysis): GoldenExclusion['reason'] | null {
  if (lap.number === analysis.firstLap || lap.number === 1) return 'first';
  if (lap.pitIn || lap.pitOut) return 'pit';
  return null;
}

export function goldenLap(samples: Sample[], analysis: RaceAnalysis, exerciseConfig: CoreConfig): GoldenLap {
  const config = raceCompareConfig(exerciseConfig);
  const laps = [...analysis.laps].sort((a, b) => a.number - b.number);
  const excluded: GoldenExclusion[] = [];
  const candidates: LapFacts[] = [];
  for (const lap of laps) {
    const reason = exclusionOf(lap, analysis);
    if (reason === null) candidates.push(lap);
    else excluded.push({ lap: lap.number, reason });
  }
  const referenceLap = lapOf(analysis, analysis.referenceLap);
  const reference = referenceLap ? referenceOf(samples, analysis, referenceLap, config) : null;
  const corners = reference?.corners ?? [];
  const lengthM = reference?.path.lengthM ?? 0;
  const zones = turnZones(corners, lengthM);
  let traces = reference ? candidates.map(lap => traceOf(samples, lap, analysis, reference.path, config)).filter(trace => trace.points.length > 1) : [];
  let edges: number[] = [];
  let cells: (Cell | null)[][] = [];
  for (;;) {
    edges = reference ? edgesOf(corners, zones, lengthM, traces) : [];
    cells = cellsOf(traces, edges, analysis);
    const kept = traces.filter((_, index) => cells.every(row => row[index] !== null));
    if (kept.length === traces.length) break;
    traces = kept;
  }
  const clean = traces.map(trace => trace.lap.number);
  for (const lap of candidates) if (!clean.includes(lap.number)) excluded.push({ lap: lap.number, reason: 'open' });
  excluded.sort((a, b) => a.lap - b.lap);
  if (clean.length < config.race.goldenMinLaps) return { state: 'too-few', cleanLaps: clean, excluded };

  const turns = corners.length === 0 ? [null] : corners.map(corner => corner.number);
  const full = cells as Cell[][];
  const usable = full.map(row => row.map(cell => !cell.off));
  const gap = usable.findIndex(row => !row.includes(true));
  if (gap >= 0) return { state: 'gap', cleanLaps: clean, turn: turns[gap]! };
  const chain = chainOf(full, usable, config);
  if (chain === null) return { state: 'no-chain', cleanLaps: clean };

  const flagged = slipstreams(corners, zones.map(zone => zone.toSM), edges, traces, config);
  const sectors = full.map((row, k): GoldenSector => {
    const times = row.flatMap((cell, index) => (usable[k]![index] ? [{ lap: clean[index]!, ms: cell.tMs }] : []));
    const best = times.reduce((fastest, time) => (time.ms < fastest.ms ? time : fastest));
    const middle = median(times.map(time => time.ms));
    const index = chain.laps[k]!;
    const ms = row[index]!.tMs;
    return {
      turn: turns[k]!,
      fromM: edges[k]!,
      toM: edges[k + 1]!,
      lap: clean[index]!,
      ms,
      bestLap: best.lap,
      bestMs: best.ms,
      medianMs: middle,
      spreadMs: middle - best.ms,
      cleanLaps: times.length,
      bestJoins: ms <= best.ms,
      slipstream: flagged.has(`${k}:${clean[index]}`)
    };
  });
  const bestClean = fastestLap(traces.map(trace => trace.lap))!;
  return {
    state: 'ok',
    bestLap: bestClean.number,
    bestMs: bestClean.timeMs,
    goldenMs: chain.ms,
    sourceLaps: [...new Set(chain.laps.map(index => clean[index]!))].sort((a, b) => a - b),
    cleanLaps: clean,
    sectors
  };
}
