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

export type RaceOptions = { laps: number[]; lapsInRace: number; pitAfter?: number[]; brakeLater?: { lap: number; m: number }; joinAtLap?: number };

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

function ovalPoint(index: number): Vec3 {
  const angle = (2 * Math.PI * index) / LAP_SAMPLES;
  return { x: OVAL_RADIUS_M * Math.sin(angle), y: 0, z: OVAL_RADIUS_M * (1 - Math.cos(angle)) };
}

export function racePositionOf(lap: number): number {
  return Math.max(1, GRID_POSITION + 1 - lap);
}

export function raceOf(options: RaceOptions): Sample[] {
  const pitAfter = new Set(options.pitAfter ?? []);
  const speedMps = (2 * Math.PI * OVAL_RADIUS_M) / ((LAP_SAMPLES * FRAME_MS) / 1000);
  const stepM = (speedMps * FRAME_MS) / 1000;
  const brakeFrom = (lap: number) => BRAKE_SAMPLE + (options.brakeLater?.lap === lap ? Math.round(options.brakeLater.m / stepM) : 0);
  const samples: Sample[] = [];
  let fuel = 100;
  let lastLapMs = -1;
  let timerMs = 0;
  const push = (lap: number, overrides: Partial<Sample>) => {
    samples.push(
      syntheticSample({ lapsInRace: options.lapsInRace, carsInRace: 16, lap, lastLapMs, fuel, racePosition: racePositionOf(lap), gameTimerMs: timerMs, ...overrides })
    );
    timerMs += FRAME_MS;
  };

  for (let index = 0; index < GRID_SAMPLES; index++) push(0, { position: ovalPoint(0), speedMps, gameTimerMs: 0, racePosition: index === 0 ? 1 : GRID_POSITION });
  options.laps.forEach((timeMs, lapIndex) => {
    const lap = lapIndex + 1;
    timerMs = 0;
    if (pitAfter.has(lap - 1)) {
      for (let index = 0; index <= STOP_SAMPLES; index++) {
        if (index > STOP_SAMPLES / 2) fuel = 100;
        push(lap, { position: BOX, speedMps: 0.001, loading: index === 0 || index === BOX_LOADING_SAMPLE });
      }
      push(lap, { position: ovalPoint(PIT_EXIT_SAMPLE), speedMps, loading: true });
    }
    const firstSample = pitAfter.has(lap - 1) ? PIT_EXIT_SAMPLE + 1 : 0;
    const lastSample = pitAfter.has(lap) ? PIT_ENTRY_SAMPLE : LAP_SAMPLES - 1;
    for (let index = firstSample; index <= lastSample; index++) {
      fuel -= FUEL_PER_LAP / LAP_SAMPLES;
      const braking = index >= brakeFrom(lap) && index < brakeFrom(lap) + BRAKE_SAMPLES;
      push(lap, { position: ovalPoint(index), speedMps, throttle: braking ? 0 : 1, brake: braking ? 0.6 : 0 });
    }
    if (pitAfter.has(lap)) {
      for (let index = 0; index < STOP_SAMPLES; index++) push(lap, { position: ovalPoint(PIT_ENTRY_SAMPLE), speedMps: 0.03 });
    }
    lastLapMs = timeMs;
  });

  const next = options.laps.length + 1;
  if (options.laps.length >= options.lapsInRace) {
    for (let index = 0; index < AFTER_FINISH_SAMPLES; index++) push(next, { position: ovalPoint(index), speedMps, throttle: 0, gameTimerMs: lastLapMs });
  } else {
    timerMs = 0;
    for (let index = 0; index < LAST_LAP_SAMPLES; index++) push(next, { position: ovalPoint(index), speedMps });
    for (let index = 0; index < SESSION_LOST_SAMPLES; index++) push(-1, { lapsInRace: -1, racePosition: -1, carsInRace: -1, playerSession: false, gameTimerMs: 0 });
  }
  const race = renumber(samples);
  if (options.joinAtLap === undefined) return race;
  const joinLapStart = race.findIndex(sample => sample.lap === options.joinAtLap);
  return race.slice(joinLapStart + LAP_SAMPLES / 2);
}
