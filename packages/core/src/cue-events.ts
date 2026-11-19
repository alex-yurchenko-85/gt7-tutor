import { KPH_PER_MPS, eventKey, type EventKind } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';
import { isSupportedTarget } from './cue-text.ts';
import type { ReferencePath, ReferencePoint } from './reference.ts';

export type EventVoice = 'hard-brake' | 'brake' | 'light-brake' | 'ease-off' | 'throttle' | 'full-throttle';

export type ReferenceCueEvent = {
  key: string;
  kind: EventKind;
  sM: number;
  endSM: number | null;
  targetSpeedKph: number | null;
  voice: EventVoice;
  bigStop: boolean;
};

export type EventPoint = Pick<ReferencePoint, 'sM' | 'speedMps' | 'throttle' | 'brake' | 'timeMs'>;

type Zone = { from: number; to: number };

type Detected = Omit<ReferenceCueEvent, 'key'>;

const ROUNDING_EPSILON = 1e-6;

export function targetKph(speedMps: number, config: CoreConfig): number | null {
  const step = config.target.roundDownKph;
  const kph = Math.floor((speedMps * KPH_PER_MPS + ROUNDING_EPSILON) / step) * step;
  return isSupportedTarget(kph) ? kph : null;
}

function holds(points: EventPoint[], index: number, count: number, test: (point: EventPoint) => boolean): boolean {
  if (index + count > points.length) return false;
  for (let offset = 0; offset < count; offset++) if (!test(points[index + offset]!)) return false;
  return true;
}

function brakeZones(points: EventPoint[], config: CoreConfig): Zone[] {
  const { consecutiveSamples: count, brakeOn, mergeWithinM } = config.events;
  const zones: Zone[] = [];
  let index = 0;
  while (index < points.length) {
    if (!holds(points, index, count, point => point.brake > brakeOn)) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < points.length - 1 && !holds(points, end, count, point => point.brake <= brakeOn)) end += 1;
    const previous = zones.at(-1);
    if (previous && points[index]!.sM - points[previous.to]!.sM <= mergeWithinM) previous.to = end;
    else zones.push({ from: index, to: end });
    index = end;
  }
  return zones;
}

function speedAtTime(points: EventPoint[], timeMs: number): number {
  const after = points.findIndex(point => point.timeMs >= timeMs);
  if (after === -1) return points.at(-1)!.speedMps;
  if (after === 0) return points[0]!.speedMps;
  const from = points[after - 1]!;
  const to = points[after]!;
  const u = (timeMs - from.timeMs) / (to.timeMs - from.timeMs);
  return from.speedMps + (to.speedMps - from.speedMps) * u;
}

function brakeVoice(lossMps: number, config: CoreConfig): EventVoice {
  if (lossMps + ROUNDING_EPSILON >= config.voice.hardBrakeLossMps) return 'hard-brake';
  if (lossMps + ROUNDING_EPSILON >= config.voice.lightBrakeLossMps) return 'brake';
  return 'light-brake';
}

function isBigStop(entryMps: number, lossMps: number, config: CoreConfig): boolean {
  return entryMps + ROUNDING_EPSILON >= config.voice.bigStopEntryMps && lossMps + ROUNDING_EPSILON >= config.voice.bigStopLossMps;
}

function brakeEvents(points: EventPoint[], zones: Zone[], config: CoreConfig): Detected[] {
  return zones.map(zone => {
    const entryMps = points[zone.from]!.speedMps;
    const lossMps = entryMps - points[zone.to]!.speedMps;
    return {
      kind: 'brake',
      sM: points[zone.from]!.sM,
      endSM: points[zone.to]!.sM,
      targetSpeedKph: targetKph(points[zone.to]!.speedMps, config),
      voice: brakeVoice(lossMps, config),
      bigStop: isBigStop(entryMps, lossMps, config)
    };
  });
}

function throttleVoice(points: EventPoint[], index: number, config: CoreConfig): EventVoice {
  const untilMs = points[index]!.timeMs + config.target.throttleLookAheadMs;
  for (let at = index; at < points.length && points[at]!.timeMs <= untilMs; at++) {
    if (points[at]!.throttle >= config.voice.fullThrottle) return 'full-throttle';
  }
  return 'throttle';
}

function brakeFollows(points: EventPoint[], zones: Zone[], index: number, config: CoreConfig): boolean {
  const liftMs = points[index]!.timeMs;
  return zones.some(zone => {
    if (zone.from <= index && zone.to >= index) return true;
    const delayMs = points[zone.from]!.timeMs - liftMs;
    return delayMs >= 0 && delayMs <= config.events.liftBrakeWindowMs;
  });
}

function pedalEvents(points: EventPoint[], zones: Zone[], config: CoreConfig): Detected[] {
  const { consecutiveSamples: count, liftFrom, liftTo, throttleOn } = config.events;
  const inZone = (index: number) => zones.some(zone => index >= zone.from && index < zone.to);
  const events: Detected[] = [];
  let onThrottle = points[0]!.throttle >= liftFrom;
  let released = !onThrottle;
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    if (zones.some(zone => zone.from === index)) released = true;
    if (onThrottle && holds(points, index, count, candidate => candidate.throttle <= liftTo)) {
      onThrottle = false;
      released = true;
      if (!brakeFollows(points, zones, index, config)) {
        events.push({ kind: 'ease-off', sM: point.sM, endSM: null, targetSpeedKph: null, voice: 'ease-off', bigStop: false });
      }
      continue;
    }
    if (released && !inZone(index) && holds(points, index, count, candidate => candidate.throttle > throttleOn)) {
      released = false;
      onThrottle = true;
      const aheadMps = speedAtTime(points, point.timeMs + config.target.throttleLookAheadMs);
      events.push({
        kind: 'throttle',
        sM: point.sM,
        endSM: null,
        targetSpeedKph: targetKph(aheadMps, config),
        voice: throttleVoice(points, index, config),
        bigStop: false
      });
      continue;
    }
    if (point.throttle >= liftFrom && !released) onThrottle = true;
  }
  return events;
}

function withoutNearRepeats(events: Detected[], config: CoreConfig): Detected[] {
  const kept: Detected[] = [];
  for (const event of events) {
    const previous = kept.filter(other => other.kind === event.kind).at(-1);
    if (event.kind !== 'brake' && previous && event.sM - previous.sM <= config.events.mergeWithinM) continue;
    kept.push(event);
  }
  return kept;
}

export function detectEvents(points: EventPoint[], lengthM: number, config: CoreConfig): ReferenceCueEvent[] {
  if (points.length === 0) return [];
  const zones = brakeZones(points, config);
  const detected = [...brakeEvents(points, zones, config), ...pedalEvents(points, zones, config)].sort((a, b) => a.sM - b.sM);
  return withoutNearRepeats(detected, config)
    .filter(event => event.sM <= lengthM - config.events.endMarginM)
    .map(event => ({ key: eventKey(event.kind, event.sM), ...event }));
}

export function buildCueEvents(path: ReferencePath, config: CoreConfig): ReferenceCueEvent[] {
  return detectEvents(path.points, path.lengthM, config);
}
