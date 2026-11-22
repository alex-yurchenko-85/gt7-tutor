import type { Sample, Vec3 } from '@gt7/contracts';

export const FRAME_MS = 1000 / 60;

export function syntheticSample(overrides: Partial<Sample> = {}): Sample {
  return {
    rawIndex: 0,
    packetId: 0,
    receivedMonoMs: 0,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    speedMps: 0,
    throttle: 0,
    brake: 0,
    gear: 1,
    lap: 1,
    lapsInRace: 0,
    bestLapMs: -1,
    lastLapMs: -1,
    racePosition: -1,
    carsInRace: -1,
    fuel: 100,
    surface: 'TTTT',
    carId: 3602,
    flags: 9,
    playerSession: true,
    paused: false,
    loading: false,
    gameTimerMs: 0,
    ...overrides
  };
}

export type Waypoint = { position: Vec3; speedMps: number; throttle?: number; brake?: number };

export function renumber(samples: Sample[], firstIndex = 0, firstMonoMs = 0): Sample[] {
  return samples.map((sample, index) => ({
    ...sample,
    rawIndex: firstIndex + index,
    packetId: firstIndex + index + 1,
    receivedMonoMs: firstMonoMs + index * FRAME_MS
  }));
}

export function drive(points: Waypoint[], overrides: Partial<Sample> = {}): Sample[] {
  return renumber(
    points.map(point =>
      syntheticSample({
        position: point.position,
        speedMps: point.speedMps,
        throttle: point.throttle ?? 0,
        brake: point.brake ?? 0,
        ...overrides
      })
    )
  );
}

export function straightLine(o: { fromX: number; toX: number; speedMps: number; z?: number; y?: number }): Waypoint[] {
  const step = (o.speedMps * FRAME_MS) / 1000;
  const direction = Math.sign(o.toX - o.fromX);
  const count = Math.floor(Math.abs(o.toX - o.fromX) / step);
  return Array.from({ length: count + 1 }, (_, index) => ({
    position: { x: o.fromX + direction * index * step, y: o.y ?? 0, z: o.z ?? 0 },
    speedMps: o.speedMps
  }));
}

export type LapPart = { lap: number; from: number; to: number };

export type RaceOptions = {
  laps: number[];
  lapsInRace: number;
  pitAfter?: number[];
  brakeLater?: { lap: number; m: number };
  joinAtLap?: number;
  track?: 'oval' | 'stadium' | 'circle';
  pace?: (LapPart & { factor: number })[];
  aside?: (LapPart & { m: number })[];
  offTrack?: LapPart[];
  positions?: number[];
  timedLaps?: boolean;
};

const OVAL_RADIUS_M = 100;
const LAP_SAMPLES = 600;
const GRID_SAMPLES = 30;
const GRID_POSITION = 8;
const STOP_SAMPLES = 120;
const PIT_ENTRY_SAMPLE = 540;
const PIT_EXIT_SAMPLE = 60;
const BRAKE_SAMPLE = 300;
const BRAKE_SAMPLES = 60;
const BOX_LOADING_SAMPLE = 10;
const FUEL_PER_LAP = 10;
const AFTER_FINISH_SAMPLES = 180;
const LAST_LAP_SAMPLES = 60;
const SESSION_LOST_SAMPLES = 120;
const BOX = { x: 0, y: 0, z: 400 };
const STADIUM_RADIUS_M = OVAL_RADIUS_M / 2;
const STADIUM_STRAIGHT_M = Math.PI * STADIUM_RADIUS_M;
const QUARTER = LAP_SAMPLES / 4;
const STADIUM_BRAKE_SAMPLES = 40;

type Track = { point: (at: number) => Vec3; brakes: number[]; brakeSamples: number };

function ovalPoint(index: number): Vec3 {
  const angle = (2 * Math.PI * index) / LAP_SAMPLES;
  return { x: OVAL_RADIUS_M * Math.sin(angle), y: 0, z: OVAL_RADIUS_M * (1 - Math.cos(angle)) };
}

function stadiumPoint(at: number): Vec3 {
  const r = STADIUM_RADIUS_M;
  const part = Math.min(3, Math.floor(at / QUARTER));
  const u = (at - part * QUARTER) / QUARTER;
  if (part === 0) return { x: u * STADIUM_STRAIGHT_M, y: 0, z: 0 };
  if (part === 1) return { x: STADIUM_STRAIGHT_M + r * Math.sin(u * Math.PI), y: 0, z: r - r * Math.cos(u * Math.PI) };
  if (part === 2) return { x: STADIUM_STRAIGHT_M * (1 - u), y: 0, z: 2 * r };
  return { x: -r * Math.sin(u * Math.PI), y: 0, z: r + r * Math.cos(u * Math.PI) };
}

const TRACKS: Record<'oval' | 'stadium' | 'circle', Track> = {
  oval: { point: ovalPoint, brakes: [BRAKE_SAMPLE], brakeSamples: BRAKE_SAMPLES },
  stadium: { point: stadiumPoint, brakes: [QUARTER - STADIUM_BRAKE_SAMPLES, 3 * QUARTER - STADIUM_BRAKE_SAMPLES], brakeSamples: STADIUM_BRAKE_SAMPLES },
  circle: { point: ovalPoint, brakes: [], brakeSamples: 0 }
};

export function racePositionOf(lap: number): number {
  return Math.max(1, GRID_POSITION + 1 - lap);
}

function partOf<T extends LapPart>(parts: T[] | undefined, lap: number, at: number): T | undefined {
  return parts?.find(part => part.lap === lap && at >= part.from && at < part.to);
}

function besideOf(track: Track, at: number, m: number): Vec3 {
  const point = track.point(at);
  const ahead = track.point(Math.min(LAP_SAMPLES, at + 0.5));
  const behind = track.point(Math.max(0, at - 0.5));
  const dx = ahead.x - behind.x;
  const dz = ahead.z - behind.z;
  const span = Math.hypot(dx, dz);
  return { x: point.x - (dz / span) * m, y: point.y, z: point.z + (dx / span) * m };
}

export function raceOf(options: RaceOptions): Sample[] {
  const track = TRACKS[options.track ?? 'oval'];
  const pitAfter = new Set(options.pitAfter ?? []);
  const speedMps = (2 * Math.PI * OVAL_RADIUS_M) / ((LAP_SAMPLES * FRAME_MS) / 1000);
  const stepM = (speedMps * FRAME_MS) / 1000;
  const brakeShift = (lap: number) => (options.brakeLater?.lap === lap ? Math.round(options.brakeLater.m / stepM) : 0);
  const positionOf = (lap: number) => options.positions?.[lap - 1] ?? racePositionOf(lap);
  const samples: Sample[] = [];
  let fuel = 100;
  let lastLapMs = -1;
  let timerMs = 0;
  const push = (lap: number, overrides: Partial<Sample>) => {
    samples.push(
      syntheticSample({ lapsInRace: options.lapsInRace, carsInRace: 16, lap, lastLapMs, fuel, racePosition: positionOf(lap), gameTimerMs: timerMs, ...overrides })
    );
    timerMs += FRAME_MS;
  };

  for (let index = 0; index < GRID_SAMPLES; index++) push(0, { position: track.point(0), speedMps, gameTimerMs: 0, racePosition: index === 0 ? 1 : GRID_POSITION });
  options.laps.forEach((timeMs, lapIndex) => {
    const lap = lapIndex + 1;
    const lapStart = samples.length;
    timerMs = 0;
    if (pitAfter.has(lap - 1)) {
      for (let index = 0; index <= STOP_SAMPLES; index++) {
        if (index > STOP_SAMPLES / 2) fuel = 100;
        push(lap, { position: BOX, speedMps: 0.001, loading: index === 0 || index === BOX_LOADING_SAMPLE });
      }
      push(lap, { position: track.point(PIT_EXIT_SAMPLE), speedMps, loading: true });
    }
    const firstSample = pitAfter.has(lap - 1) ? PIT_EXIT_SAMPLE + 1 : 0;
    const lastSample = pitAfter.has(lap) ? PIT_ENTRY_SAMPLE : LAP_SAMPLES - 1;
    for (let at = firstSample; at <= lastSample; at += partOf(options.pace, lap, at)?.factor ?? 1) {
      fuel -= FUEL_PER_LAP / LAP_SAMPLES;
      const braking = track.brakes.some(from => at >= from + brakeShift(lap) && at < from + brakeShift(lap) + track.brakeSamples);
      const side = partOf(options.aside, lap, at)?.m ?? 0;
      push(lap, {
        position: side === 0 ? track.point(at) : besideOf(track, at, side),
        speedMps: speedMps * (partOf(options.pace, lap, at)?.factor ?? 1),
        throttle: braking ? 0 : 1,
        brake: braking ? 0.6 : 0,
        ...(partOf(options.offTrack, lap, at) ? { surface: 'GGTT' } : {})
      });
    }
    if (pitAfter.has(lap)) {
      for (let index = 0; index < STOP_SAMPLES; index++) push(lap, { position: track.point(PIT_ENTRY_SAMPLE), speedMps: 0.03 });
    }
    lastLapMs = options.timedLaps ? (samples.length - lapStart) * FRAME_MS : timeMs;
  });

  const next = options.laps.length + 1;
  if (options.laps.length >= options.lapsInRace) {
    for (let index = 0; index < AFTER_FINISH_SAMPLES; index++) push(next, { position: track.point(index), speedMps, throttle: 0, gameTimerMs: lastLapMs });
  } else {
    timerMs = 0;
    for (let index = 0; index < LAST_LAP_SAMPLES; index++) push(next, { position: track.point(index), speedMps });
    for (let index = 0; index < SESSION_LOST_SAMPLES; index++) push(-1, { lapsInRace: -1, racePosition: -1, carsInRace: -1, playerSession: false, gameTimerMs: 0 });
  }
  const race = renumber(samples);
  if (options.joinAtLap === undefined) return race;
  const joinLapStart = race.findIndex(sample => sample.lap === options.joinAtLap);
  return race.slice(joinLapStart + LAP_SAMPLES / 2);
}
