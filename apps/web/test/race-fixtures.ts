import { KPH_PER_MPS, type RaceCompare, type RaceDetail, type RaceDistances, type RaceLap, type RaceLapsSpeed, type RaceOffTrack, type RaceOffTrackView, type RaceRecurringPlace } from '@gt7/contracts';
import { review } from './review-fixtures.ts';

export const RACE_ID = 'a0000000-0000-4000-8000-000000000001';

type LapInput = [number, number, number, number, number, number, number, boolean, boolean];

function lapOf([number, timeMs, positionStart, positionEnd, topKph, offAll, offPart, pitIn, pitOut]: LapInput): RaceLap {
  return { number, timeMs, positionStart, positionEnd, topSpeedMps: topKph / KPH_PER_MPS, fuelStart: 100, fuelEnd: 90, pitIn, pitOut, closed: number !== 1 && !pitIn && !pitOut, offAll, offPart };
}

export const PANORAMA_LAPS: RaceLap[] = (
  [
    [1, 142_032, 20, 9, 276, 0, 1, false, false],
    [2, 157_850, 9, 11, 281, 0, 3, true, false],
    [3, 139_931, 11, 6, 282, 1, 2, false, true],
    [4, 138_285, 6, 2, 281, 1, 0, false, false],
    [5, 163_518, 2, 2, 280, 0, 2, true, false],
    [6, 147_847, 2, 2, 280, 3, 1, false, true],
    [7, 140_305, 2, 2, 280, 1, 5, false, false]
  ] as LapInput[]
).map(lapOf);

export function raceDetail(overrides: Partial<RaceDetail> = {}): RaceDetail {
  return {
    id: RACE_ID,
    trackName: 'Mount Panorama',
    trackCandidates: ['Mount Panorama'],
    carId: 3437,
    carName: "BAC Mono '16",
    firstLap: 1,
    lapsDone: 7,
    lapsInRace: 7,
    cars: 20,
    startPosition: 20,
    finishPosition: 2,
    raceMs: 1_029_768,
    bestLap: 4,
    bestLapMs: 138_285,
    pitStops: 2,
    offTrack: 20,
    complete: true,
    startedAt: new Date(2026, 10, 20, 17, 36).toISOString(),
    referenceLap: 4,
    lapLengthM: 6165.2,
    laps: PANORAMA_LAPS,
    pitStopList: [
      { afterLap: 2, durationMs: 35_480, fuelBefore: 38.2, fuelAfter: 100, fromMs: 285_000, toMs: 320_480 },
      { afterLap: 5, durationMs: 38_190, fuelBefore: 11.4, fuelAfter: 100, fromMs: 730_000, toMs: 768_190 }
    ],
    offTrackList: [],
    recurring: [],
    position: [
      { tMs: 0, position: 20 },
      { tMs: 60_000, position: 15 },
      { tMs: 142_032, position: 9 },
      { tMs: 290_000, position: 11 },
      { tMs: 600_000, position: 2 }
    ],
    fuel: [
      { tMs: 0, fuel: 100 },
      { tMs: 290_000, fuel: 38 },
      { tMs: 310_000, fuel: 100 },
      { tMs: 1_029_768, fuel: 40 }
    ],
    ...overrides
  };
}

export const DISTANCE_LAP_M = 6000;

export function raceDistances(detail: RaceDetail = raceDetail()): RaceDistances {
  let startMs = 0;
  return {
    points: detail.laps.flatMap(lap => {
      const points = [
        { lap: lap.number, tMs: startMs, sM: 0 },
        { lap: lap.number, tMs: startMs + lap.timeMs, sM: DISTANCE_LAP_M }
      ];
      startMs += lap.timeMs;
      return points;
    })
  };
}

export const SPEED_GRID_M = 10;

export function lapsSpeed(firstLap = 1, count = 7, bestLap = 4): RaceLapsSpeed {
  const points = Math.ceil(6165 / SPEED_GRID_M) + 1;
  return {
    gridM: SPEED_GRID_M,
    lengthM: 6165,
    turns: [
      { turn: 1, fromSM: 500, toSM: 800 },
      { turn: 2, fromSM: 1700, toSM: 1900 }
    ],
    laps: Array.from({ length: count }, (_, index) => {
      const number = firstLap + index;
      const kph = number === bestLap ? 148 : 140 + index * 2;
      return {
        number,
        v: Array.from({ length: points }, (_, at) => {
          if (number === firstLap + 1 && at >= points - 20) return null;
          if (number === firstLap + 2 && number !== bestLap && at < 20) return null;
          return kph / KPH_PER_MPS;
        })
      };
    })
  };
}

export const RING_ID = 'a0000000-0000-4000-8000-000000000002';

const RING_TIMES = [83_585, 77_623, 78_765, 79_208, 79_336];

export function ringDetail(overrides: Partial<RaceDetail> = {}): RaceDetail {
  const laps = RING_TIMES.map((timeMs, index) => ({ ...PANORAMA_LAPS[0]!, number: index + 1, timeMs, pitIn: false, pitOut: false, closed: index > 0, offAll: 0, offPart: 0 }));
  return raceDetail({
    id: RING_ID,
    trackName: 'High Speed Ring',
    trackCandidates: ['High Speed Ring'],
    carName: 'Lexus RC F Gr.4',
    lapsDone: 5,
    lapsInRace: 5,
    startPosition: 10,
    raceMs: 398_517,
    bestLap: 2,
    bestLapMs: 77_623,
    referenceLap: 2,
    pitStops: 0,
    pitStopList: [],
    offTrack: 0,
    lapLengthM: 4350,
    laps,
    ...overrides
  });
}

export function raceCompare(overrides: Partial<RaceCompare> = {}): RaceCompare {
  const base = review();
  return {
    lap: 5,
    withLap: 2,
    lapMs: 79_336,
    withMs: 77_623,
    gridM: base.gridM,
    lengthM: base.lengthM,
    reference: base.reference,
    attempt: base.attempt,
    referenceEvents: base.referenceEvents,
    attemptEvents: base.attemptEvents,
    findings: [
      { kind: 'brake-early', eventKey: 'brake@10', sM: 10, size: 70, unit: 'm', turn: 1 },
      { kind: 'slow-corner', eventKey: null, sM: 14, size: 16 / 3.6, unit: 'm/s', turn: 1 }
    ],
    turnLosses: [
      { turn: 1, fromSM: 8, toSM: 15, lostMs: 400 },
      { turn: 2, fromSM: 16, toSM: 18, lostMs: 3 },
      { turn: 3, fromSM: 18, toSM: 20, lostMs: -460 }
    ],
    corners: [
      { number: 1, turnInSM: 8, apexSM: 12, radiusM: 40, apexSpeedMps: 25, zoneFromSM: 8, zoneToSM: 15, brakeToSM: null, brakeAtTurnIn: null, lowSpeedSM: null, lowSpeedMps: null, lowSpeedAtApex: false, outsideM: null, speedMps: 24, attemptLowSM: null, attemptLowMps: null }
    ],
    ...overrides
  };
}

export function offTrackMoment(lap: number, sM: number | null, wheels: 2 | 3 | 4, durationMs = 1000, speedInKph = 104, speedMinKph = 64): RaceOffTrack {
  return { lap, sM, x: 0, z: 0, wheels, durationMs, speedInMps: speedInKph / KPH_PER_MPS, speedMinMps: speedMinKph / KPH_PER_MPS };
}

export const PANORAMA_MOMENTS: RaceOffTrack[] = [
  offTrackMoment(1, 5040, 2),
  offTrackMoment(2, 3190, 2),
  offTrackMoment(3, 2910, 4),
  offTrackMoment(3, 3190, 3),
  offTrackMoment(4, 3190, 4),
  offTrackMoment(6, 3334, 4, 1040, 104, 64),
  offTrackMoment(6, 3190, 2),
  offTrackMoment(7, 3190, 2)
];

export const PANORAMA_PLACES: RaceRecurringPlace[] = [
  { label: 'A', sM: 3190, fromSM: 3150, toSM: 3230, x: 0, z: 0, laps: [2, 3, 4, 5, 6, 7], allWheels: 1, largestLossMps: 143 / KPH_PER_MPS },
  { label: 'B', sM: 3350, fromSM: 3300, toSM: 3400, x: 0, z: 0, laps: [5, 6, 7], allWheels: 0, largestLossMps: 41 / KPH_PER_MPS }
];

export function offTrackView(overrides: Partial<RaceOffTrackView> = {}): RaceOffTrackView {
  const gridM = 10;
  const lengthM = 6165;
  const points = Math.ceil(lengthM / gridM) + 1;
  return {
    gridM,
    lengthM,
    x: Array.from({ length: points }, (_, index) => 500 * Math.cos((2 * Math.PI * index) / points)),
    z: Array.from({ length: points }, (_, index) => 300 * Math.sin((2 * Math.PI * index) / points)),
    heightM: Array.from({ length: points }, (_, index) => (index < points / 2 ? index * 0.4 : (points - index) * 0.4)),
    speedMps: Array.from({ length: points }, () => 89 / KPH_PER_MPS),
    pitLane: [
      { lap: 2, fromSM: 5900, toSM: 6165 },
      { lap: 3, fromSM: 0, toSM: 260 },
      { lap: 5, fromSM: 5940, toSM: 6165 },
      { lap: 6, fromSM: 0, toSM: 260 }
    ],
    moments: PANORAMA_MOMENTS,
    recurring: PANORAMA_PLACES,
    ...overrides
  };
}
