import { describe, expect, it } from 'vitest';
import { buildCueEvents } from '../src/cue-events.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { inZone, profiledPath, interlagosReference, type ProfilePoint } from './paths.ts';

const cruise: ProfilePoint = { speedKph: 200, throttle: 1, brake: 0 };

function brakeThenAccelerate(endKph: number) {
  return (sM: number): ProfilePoint => {
    if (sM < 100) return cruise;
    if (sM < 150) return { speedKph: 200 - ((200 - endKph) * (sM - 100)) / 50, throttle: 0, brake: 0.8 };
    if (sM < 160) return { speedKph: endKph, throttle: 0, brake: 0 };
    return { speedKph: Math.min(250, endKph + (sM - 160) * 0.5), throttle: 1, brake: 0 };
  };
}

function zone(entryKph: number, endKph: number, throttle = 1) {
  return (sM: number): ProfilePoint => {
    if (sM < 100) return { speedKph: entryKph, throttle: 1, brake: 0 };
    if (sM < 150) return { speedKph: entryKph - ((entryKph - endKph) * (sM - 100)) / 50, throttle: 0, brake: 0.8 };
    if (sM < 160) return { speedKph: endKph, throttle: 0, brake: 0 };
    return { speedKph: Math.min(entryKph, endKph + (sM - 160) * 0.5), throttle, brake: 0 };
  };
}

function brakeOf(entryKph: number, endKph: number) {
  return buildCueEvents(profiledPath(400, zone(entryKph, endKph)), DEFAULT_CONFIG).find(event => event.kind === 'brake')!;
}

describe('phrase strength', () => {
  it('interlagos_phrases', () => {
    const events = buildCueEvents(interlagosReference(), DEFAULT_CONFIG);
    expect(events.map(event => [event.key, event.voice, event.bigStop])).toEqual([
      ['brake@291', 'hard-brake', true],
      ['throttle@411', 'full-throttle', false],
      ['ease-off@564', 'ease-off', false],
      ['throttle@568', 'full-throttle', false],
      ['ease-off@792', 'ease-off', false],
      ['throttle@796', 'full-throttle', false]
    ]);
  });

  it('brake_strength_limits', () => {
    expect(brakeOf(200, 140.1).voice).toBe('brake');
    expect(brakeOf(200, 140).voice).toBe('hard-brake');
    expect(brakeOf(200, 175.1).voice).toBe('light-brake');
    expect(brakeOf(200, 175).voice).toBe('brake');
  });

  it('throttle_below_095_is_throttle', () => {
    const throttleAt = (value: number) =>
      buildCueEvents(profiledPath(600, zone(200, 100, value)), DEFAULT_CONFIG).find(event => event.kind === 'throttle')!.voice;
    expect(throttleAt(0.94)).toBe('throttle');
    expect(throttleAt(0.95)).toBe('full-throttle');
  });

  it('ease_off_keeps_its_voice', () => {
    const liftOnly = profiledPath(500, sM => (sM < 100 || sM >= 250 ? cruise : { speedKph: 180, throttle: 0, brake: 0 }));
    const easeOff = buildCueEvents(liftOnly, DEFAULT_CONFIG).find(event => event.kind === 'ease-off')!;
    expect(easeOff.voice).toBe('ease-off');
    expect(easeOff.bigStop).toBe(false);
  });

  it('big_stop_needs_entry_and_loss', () => {
    expect(brakeOf(199, 79).bigStop).toBe(false);
    expect(brakeOf(200, 101).bigStop).toBe(false);
    expect(brakeOf(200, 100).bigStop).toBe(true);
  });

  it('event_keys_do_not_change', () => {
    expect(buildCueEvents(interlagosReference(), DEFAULT_CONFIG).map(event => event.key)).toEqual([
      'brake@291',
      'throttle@411',
      'ease-off@564',
      'throttle@568',
      'ease-off@792',
      'throttle@796'
    ]);
  });
});

describe('buildCueEvents', () => {
  it('interlagos_reference_events', () => {
    const path = interlagosReference();
    const events = buildCueEvents(path, DEFAULT_CONFIG);
    const first = events[0]!;
    expect(first.kind).toBe('brake');
    expect(Math.abs(first.sM - 291)).toBeLessThanOrEqual(10);
    expect(first.targetSpeedKph).toBe(115);
    expect(first.endSM).not.toBeNull();
    expect(events.slice(0, 4).map(event => event.kind)).toEqual(['brake', 'throttle', 'ease-off', 'throttle']);
    expect(events.every(event => event.sM <= path.lengthM - 20)).toBe(true);
    expect(events.every(event => event.key === `${event.kind}@${Math.round(event.sM)}`)).toBe(true);
    expect(new Set(events.map(event => event.key)).size).toBe(events.length);
  });

  it('braking_target_is_corner_entry_speed', () => {
    const events = buildCueEvents(profiledPath(400, brakeThenAccelerate(83)), DEFAULT_CONFIG);
    const brake = events.find(event => event.kind === 'brake')!;
    expect(brake.sM).toBe(100);
    expect(brake.endSM).toBe(150);
    expect(brake.targetSpeedKph).toBe(80);
  });

  it('acceleration_names_the_upcoming_target', () => {
    const path = profiledPath(600, brakeThenAccelerate(83));
    const throttle = buildCueEvents(path, DEFAULT_CONFIG).find(event => event.kind === 'throttle')!;
    expect(throttle.sM).toBe(160);
    expect(throttle.endSM).toBeNull();
    const eventTime = path.points[160]!.timeMs;
    const ahead = path.points.find(point => point.timeMs >= eventTime + 2000)!;
    expect(Math.abs(ahead.speedMps * 3.6 - (throttle.targetSpeedKph! + 2.5))).toBeLessThanOrEqual(3);
    expect(throttle.targetSpeedKph! % 5).toBe(0);
    expect(throttle.targetSpeedKph!).toBeGreaterThan(100);
  });

  it('targets_round_down_to_5', () => {
    const at = (endKph: number) =>
      buildCueEvents(profiledPath(400, brakeThenAccelerate(endKph)), DEFAULT_CONFIG).find(event => event.kind === 'brake')!
        .targetSpeedKph;
    expect(at(89.9)).toBe(85);
    expect(at(90)).toBe(90);
    expect(at(94.99)).toBe(90);
  });

  it('target_outside_supported_range_is_null', () => {
    const brake = buildCueEvents(profiledPath(400, brakeThenAccelerate(20)), DEFAULT_CONFIG).find(event => event.kind === 'brake')!;
    expect(brake.targetSpeedKph).toBeNull();
  });

  it('same_kind_within_5_m_merges', () => {
    const zones = [
      { fromM: 100, toM: 120 },
      { fromM: 124, toM: 140 },
      { fromM: 200, toM: 220 }
    ];
    const path = profiledPath(400, sM =>
      sM >= 100 && sM < 250
        ? { speedKph: 120, throttle: sM >= 230 ? 1 : 0, brake: inZone(sM, zones) ? 0.8 : 0 }
        : cruise
    );
    const brakes = buildCueEvents(path, DEFAULT_CONFIG).filter(event => event.kind === 'brake');
    expect(brakes.map(event => [event.sM, event.endSM])).toEqual([
      [100, 140],
      [200, 220]
    ]);
  });

  it('lift_followed_by_brake_is_not_ease_off', () => {
    const liftThenBrake = profiledPath(400, sM => {
      if (sM < 100) return cruise;
      if (sM < 110) return { speedKph: 200, throttle: 0, brake: 0 };
      if (sM < 150) return { speedKph: 150, throttle: 0, brake: 0.8 };
      return { speedKph: 150, throttle: 1, brake: 0 };
    });
    expect(buildCueEvents(liftThenBrake, DEFAULT_CONFIG).map(event => event.kind)).toEqual(['brake', 'throttle']);

    const liftOnly = profiledPath(500, sM => {
      if (sM < 100 || sM >= 250) return cruise;
      return { speedKph: 180, throttle: 0, brake: 0 };
    });
    const events = buildCueEvents(liftOnly, DEFAULT_CONFIG);
    expect(events.map(event => [event.kind, event.sM])).toEqual([
      ['ease-off', 100],
      ['throttle', 250]
    ]);
    expect(events[0]!.targetSpeedKph).toBeNull();
  });

  it('partial_lift_is_not_an_event', () => {
    const path = profiledPath(400, sM => (sM >= 100 && sM < 150 ? { speedKph: 200, throttle: 0.4, brake: 0 } : cruise));
    expect(buildCueEvents(path, DEFAULT_CONFIG)).toEqual([]);
  });

  it('short_pedal_blip_is_not_an_event', () => {
    const path = profiledPath(400, sM => (sM >= 100 && sM < 102 ? { speedKph: 200, throttle: 1, brake: 0.5 } : cruise));
    expect(buildCueEvents(path, DEFAULT_CONFIG)).toEqual([]);
  });
});
