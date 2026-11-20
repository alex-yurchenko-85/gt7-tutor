import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Coach, type CoachInput } from '../src/coach.ts';
import { replayCoach } from '../src/coach-replay.ts';
import { DEFAULT_CONFIG, DEFAULT_SIDE_CUE_DISTANCE_M } from '../src/config.ts';
import { buildCueEvents } from '../src/cue-events.ts';
import { estimatedPhraseMs } from '../src/cue-text.ts';
import { Matcher } from '../src/match.ts';
import { between, samplesOf } from './fixtures.ts';
import { analysisOf, bendPath, bendWaypoints, interlagosReference } from './paths.ts';
import { drive } from './synthetic.ts';
import { findCorners, type Corner } from '../src/corners.ts';
import type { ReferenceCueEvent } from '../src/cue-events.ts';
import { decisionFor, event, flatPath, runCoach, settingsOf, simulate } from './coaching.ts';

const reference = (sM: number) => (sM < 600 ? 200 : sM < 680 ? 200 - (sM - 600) * 1.25 : sM < 700 ? 100 : Math.min(200, 100 + (sM - 700) * 0.5));
const brakePath = flatPath(2000, reference);
const brake600 = event('brake', 600, 100, 680);
const throttle700 = event('throttle', 700, 150);
const brake1200 = event('brake', 1200, 100, 1260);

function followReference(lateralM = 0) {
  return (sM: number) => ({ speedKph: reference(sM), lateralM, brake: sM >= 600 && sM < 680 ? 0.8 : 0 });
}

describe('Coach', () => {
  const slowRun = samplesOf('ce-slow');
  const path = interlagosReference();
  const events = buildCueEvents(path, DEFAULT_CONFIG);
  const attempt = between(slowRun, 5491, 6624);

  it('slow_run_gets_each_brake_cue_once_before_its_event', () => {
    const run = runCoach(path, events, attempt, { deviceDelayMs: 60 });
    const matcher = new Matcher(path, DEFAULT_CONFIG);
    const progress = attempt.map(sample => ({ sample, match: matcher.step(sample) }));
    for (const brake of events.filter(candidate => candidate.kind === 'brake')) {
      const cues = run.cues.filter(decision => decision.cue.eventKey === brake.key);
      expect(cues, brake.key).toHaveLength(1);
      const cue = cues[0]!.cue;
      const reached = progress.find(entry => entry.match && entry.match.sM >= brake.sM)!;
      expect(reached.sample.receivedMonoMs - cue.decidedMonoMs, brake.key).toBeGreaterThanOrEqual(60 + 500);
      expect(cue.id).toBe(`1:${brake.key}`);
      expect(cue.clip).toBe(brake.voice);
      expect(cue.priority).toBe(100);
    }
  });

  it('brake_word_comes_reaction_time_before_the_point', () => {
    const steady = flatPath(2000, () => 250);
    const samples = simulate(1500, () => ({ speedKph: 250 }));
    for (const deviceDelayMs of [0, 60, 240]) {
      const run = runCoach(steady, [event('brake', 1200, 100, 1260)], samples, { deviceDelayMs });
      const cue = run.cues[0]!.cue;
      const reached = samples.find(sample => sample.position.x >= 1200)!;
      const leadMs = reached.receivedMonoMs - cue.decidedMonoMs;
      expect(leadMs, String(deviceDelayMs)).toBeGreaterThanOrEqual(deviceDelayMs + 500);
      expect(leadMs, String(deviceDelayMs)).toBeLessThan(deviceDelayMs + 500 + 40);
    }
  });

  it('determinism', () => {
    const first = runCoach(path, events, attempt);
    const second = runCoach(path, events, attempt);
    expect(second.cues.map(decision => [decision.cue.id, decision.cue.decidedMonoMs])).toEqual(
      first.cues.map(decision => [decision.cue.id, decision.cue.decidedMonoMs])
    );
    expect(second.suppressed).toEqual(first.suppressed);
  });

  it('brake_beats_throttle', () => {
    const together = [event('brake', 600, 100, 680), event('throttle', 600, 150), event('ease-off', 600, null)];
    const run = runCoach(brakePath, together, simulate(900, followReference()));
    expect(run.cues.map(decision => decision.cue.eventKey)).toEqual(['brake@600']);
    expect(['lower-priority', 'cooldown']).toContain(decisionFor(run, 'ease-off@600'));
    expect(decisionFor(run, 'throttle@600')).not.toBe('cue');
  });

  it('cooldown_1500_ms', () => {
    const steady = flatPath(1500, () => 150);
    const close = [event('brake', 600, 100, 610), event('brake', 640, 100, 650), event('brake', 800, 100, 810)];
    const run = runCoach(steady, close, simulate(1000, () => ({ speedKph: 150 })));
    expect(decisionFor(run, 'brake@600')).toBe('cue');
    expect(decisionFor(run, 'brake@640')).toBe('cooldown');
    expect(decisionFor(run, 'brake@800')).toBe('cue');
    const [first, third] = run.cues;
    expect(third!.cue.decidedMonoMs - first!.cue.decidedMonoMs).toBeGreaterThanOrEqual(1500);
  });

  it('higher_priority_cue_is_not_blocked_by_cooldown', () => {
    const steady = flatPath(1500, () => 150);
    const run = runCoach(steady, [event('ease-off', 600, null), event('brake', 640, 100, 650)], simulate(1000, () => ({ speedKph: 150 })));
    expect(run.cues.map(decision => decision.cue.eventKey)).toEqual(['ease-off@600', 'brake@640']);
  });

  it('one_cue_per_event_and_generation', () => {
    const coach = new Coach(analysisOf(brakePath, [brake600, brake1200]), DEFAULT_CONFIG, settingsOf());
    const samples = simulate(1500, followReference());
    const first = runCoach(brakePath, [], samples, { coach, generation: 1 });
    const again = runCoach(brakePath, [], samples, { coach, generation: 1 });
    expect(first.cues.map(decision => decision.cue.id)).toEqual(['1:brake@600', '1:brake@1200']);
    expect(again.cues).toEqual([]);
    const next = runCoach(brakePath, [], samples, { coach, generation: 2 });
    expect(next.cues.map(decision => decision.cue.id)).toEqual(['2:brake@600', '2:brake@1200']);
    const switched = runCoach(brakePath, [], samples, { coach, generation: 3 });
    expect(switched.cues.map(decision => decision.cue.id)).toEqual(['3:brake@600', '3:brake@1200']);
  });

  it('jump_back_in_one_generation_decides_no_passed_event_again', () => {
    const coach = new Coach(analysisOf(brakePath, [brake600, throttle700, brake1200]), DEFAULT_CONFIG, settingsOf());
    const samples = simulate(1500, followReference());
    const first = runCoach(brakePath, [], samples.filter(sample => sample.position.x < 650), { coach });
    expect(decisionFor(first, 'brake@600')).toBe('cue');
    expect(decisionFor(first, 'throttle@700')).toBe('none');
    const shiftMs = samples.at(-1)!.receivedMonoMs + 1000;
    const back = runCoach(brakePath, [], samples.map(sample => ({ ...sample, receivedMonoMs: sample.receivedMonoMs + shiftMs })), { coach });
    const keys = [...back.cues.map(decision => decision.cue.eventKey), ...back.suppressed.map(entry => entry.eventKey)];
    expect(keys.filter(key => key === 'brake@600')).toEqual([]);
    expect(keys.filter(key => key === 'throttle@700')).toHaveLength(1);
    expect(decisionFor(back, 'brake@1200')).toBe('cue');
    const again = runCoach(brakePath, [], samples.map(sample => ({ ...sample, receivedMonoMs: sample.receivedMonoMs + 2 * shiftMs })), { coach });
    expect(again.cues).toEqual([]);
    expect(again.suppressed).toEqual([]);
  });

  it('muted_event_is_suppressed_and_reported', () => {
    const run = runCoach(brakePath, [brake600, brake1200], simulate(1500, followReference()), { mutedKeys: new Set(['brake@600']) });
    expect(run.cues.map(decision => decision.cue.eventKey)).toEqual(['brake@1200']);
    expect(run.suppressed.filter(entry => entry.eventKey === 'brake@600')).toEqual([
      expect.objectContaining({ eventKey: 'brake@600', why: 'muted' })
    ]);
  });

  it('no_cue_when_paused_loading_stale_or_untrusted', () => {
    const samples = simulate(900, followReference());
    const normal = runCoach(brakePath, [brake600], samples);
    const decisionIndex = normal.cues[0]!.index;
    const at = (change: (input: CoachInput) => CoachInput) =>
      runCoach(brakePath, [brake600], samples.slice(0, decisionIndex + 1), {
        input: (input, index) => (index === decisionIndex ? change(input) : input)
      }).cues.filter(decision => !decision.cue.kind.startsWith('guidance')).length;
    expect(at(input => input)).toBe(1);
    expect(at(input => ({ ...input, sample: { ...input.sample, paused: true } }))).toBe(0);
    expect(at(input => ({ ...input, sample: { ...input.sample, loading: true } }))).toBe(0);
    expect(at(input => ({ ...input, sample: { ...input.sample, playerSession: false } }))).toBe(0);
    expect(at(input => ({ ...input, nowMonoMs: input.sample.receivedMonoMs + 151 }))).toBe(0);
    expect(at(input => ({ ...input, nowMonoMs: input.sample.receivedMonoMs + 150 }))).toBe(1);
    expect(at(input => ({ ...input, match: input.match && { ...input.match, trusted: false } }))).toBe(0);
    expect(at(input => ({ ...input, match: null }))).toBe(0);
  });

  it('throttle_needs_a_safe_state_not_a_deficit', () => {
    const steady = flatPath(1500, () => 150);
    const throttle = [event('throttle', 600, 150)];
    const state = (o: { speedKph?: number; lateralM?: number; velocityAngleDeg?: number; brake?: number } = {}) => () => ({
      speedKph: o.speedKph ?? 150,
      lateralM: o.lateralM ?? 0,
      velocityAngleDeg: o.velocityAngleDeg ?? 0,
      brake: o.brake ?? 0,
      throttle: 0.3
    });
    expect(runCoach(steady, [], simulate(1000, state())).cues).toEqual([]);
    expect(decisionFor(runCoach(steady, throttle, simulate(1000, state())), 'throttle@600')).toBe('cue');
    expect(decisionFor(runCoach(steady, throttle, simulate(1000, state({ speedKph: 120 }))), 'throttle@600')).toBe('cue');
    expect(decisionFor(runCoach(steady, throttle, simulate(1000, state({ velocityAngleDeg: 15 }))), 'throttle@600')).toBe('acceleration-unsafe');
    expect(decisionFor(runCoach(steady, throttle, simulate(1000, state({ brake: 0.2 }))), 'throttle@600')).toBe('acceleration-unsafe');
    expect(decisionFor(runCoach(steady, throttle, simulate(1000, state({ speedKph: 160 }))), 'throttle@600')).toBe('acceleration-unsafe');
    const cue = runCoach(steady, throttle, simulate(1000, state())).cues[0]!.cue;
    expect(cue).toMatchObject({ kind: 'throttle', targetSpeedKph: 150, clip: 'throttle', followClip: null, priority: 20 });
  });

  it('throttle_lateral_limit_is_3_m', () => {
    const steady = flatPath(1500, () => 150);
    const throttle = [event('throttle', 600, 150)];
    const aside = (lateralM: number) => simulate(1000, () => ({ speedKph: 150, lateralM, throttle: 0.3 }));
    expect(decisionFor(runCoach(steady, throttle, aside(2.5)), 'throttle@600')).toBe('cue');
    expect(decisionFor(runCoach(steady, throttle, aside(-2.5)), 'throttle@600')).toBe('cue');
    expect(decisionFor(runCoach(steady, throttle, aside(3.5)), 'throttle@600')).toBe('acceleration-unsafe');
  });

  it('throttle_word_comes_reaction_time_before_the_point', () => {
    const steady = flatPath(2000, () => 250);
    const samples = simulate(1500, () => ({ speedKph: 250, throttle: 0.3 }));
    for (const deviceDelayMs of [0, 60, 240]) {
      const run = runCoach(steady, [event('throttle', 1200, 250)], samples, { deviceDelayMs });
      const cue = run.cues[0]!.cue;
      const reached = samples.find(sample => sample.position.x >= 1200)!;
      const leadMs = reached.receivedMonoMs - cue.decidedMonoMs;
      expect(leadMs, String(deviceDelayMs)).toBeGreaterThanOrEqual(deviceDelayMs + 500);
      expect(leadMs, String(deviceDelayMs)).toBeLessThan(deviceDelayMs + 500 + 40);
    }
  });

  it('throttle_cue_waits_for_a_safe_state_but_never_comes_after_the_point', () => {
    const steady = flatPath(1500, () => 150);
    const throttle = [event('throttle', 600, 150)];
    const brakingUntil = (releaseM: number) => simulate(1000, sM => ({ speedKph: 150, brake: sM < releaseM ? 0.3 : 0, throttle: 0.3 }));
    const released = runCoach(steady, throttle, brakingUntil(585));
    const cue = released.cues.find(decision => decision.cue.eventKey === 'throttle@600')!;
    expect(cue.sM!).toBeGreaterThanOrEqual(585);
    expect(cue.sM!).toBeLessThan(600);
    expect(decisionFor(runCoach(steady, throttle, brakingUntil(599)), 'throttle@600')).toBe('acceleration-unsafe');
    expect(runCoach(steady, throttle, brakingUntil(599)).cues).toEqual([]);
  });

  it('offset_moves_a_throttle_cue', () => {
    const steady = flatPath(1500, () => 150);
    const samples = simulate(1000, () => ({ speedKph: 150, throttle: 0.3 }));
    const throttle = [event('throttle', 600, 150)];
    const base = runCoach(steady, throttle, samples).cues[0]!.cue.decidedMonoMs;
    const moved = runCoach(steady, throttle, samples, { offsetsMs: new Map([['throttle@600', 500]]) }).cues[0]!.cue.decidedMonoMs;
    expect(Math.abs(base - moved - 500)).toBeLessThanOrEqual(20);
  });

  it('unknown_stability_suppresses_acceleration', () => {
    const steady = flatPath(1500, () => 150);
    const throttle = [event('throttle', 60, 150)];
    const run = runCoach(steady, throttle, simulate(400, () => ({ speedKph: 120 }), 5));
    const cue = run.cues.find(decision => decision.cue.eventKey === 'throttle@60')!;
    expect(cue.cue.decidedMonoMs).toBeGreaterThanOrEqual(DEFAULT_CONFIG.acceleration.stableHoldMs);
    const creeping = runCoach(steady, throttle, simulate(80, () => ({ speedKph: 5 }), 5));
    expect(creeping.cues).toEqual([]);
  });

  it('acceleration_suppressed_when_brake_event_in_horizon', () => {
    const steady = flatPath(1500, () => 150);
    const run = runCoach(steady, [event('throttle', 600, 150), event('brake', 650, 100, 660)], simulate(1000, () => ({ speedKph: 100 })));
    expect(decisionFor(run, 'throttle@600')).toBe('brake-in-horizon');
    expect(decisionFor(run, 'brake@650')).toBe('cue');
  });

  it('missed_braking_cancels_dependent_throttle', () => {
    const late = (sM: number) => ({ speedKph: sM < 720 ? 200 : reference(sM), brake: sM >= 700 && sM < 720 ? 1 : 0 });
    const run = runCoach(brakePath, [brake600, throttle700, brake1200], simulate(1500, late));
    expect(decisionFor(run, 'brake@600')).toBe('cue');
    expect(decisionFor(run, 'throttle@700')).toBe('target-incompatible');
    expect(run.guidance.map(entry => entry.state)).toContainEqual({ mode: 'suspended', reason: 'target-incompatible' });
    expect(run.cues.some(decision => decision.cue.kind === 'throttle')).toBe(false);
    expect(run.cues.map(decision => decision.cue.kind)).toEqual(['brake', 'brake']);
    expect(decisionFor(run, 'brake@1200')).toBe('cue');
  });

  it('ignoring_a_cue_without_leaving_the_valid_envelope_keeps_guidance', () => {
    const slightlyLate = (sM: number) => ({
      speedKph: sM < 610 ? 200 : Math.max(reference(sM), Math.min(200, reference(sM) + 8)),
      brake: sM >= 610 && sM < 680 ? 0.9 : 0
    });
    const run = runCoach(brakePath, [brake600, throttle700, brake1200], simulate(1500, slightlyLate));
    expect(run.guidance.every(entry => entry.state.mode === 'active')).toBe(true);
    expect(decisionFor(run, 'throttle@700')).not.toBe('target-incompatible');
    expect(decisionFor(run, 'brake@1200')).toBe('cue');
  });

  it('future_section_can_resume_but_skipped_cues_never_replay', () => {
    const steady = flatPath(2000, () => 150);
    const offLine = (sM: number) => ({ speedKph: 150, lateralM: sM >= 300 && sM < 700 ? 9 : 0 });
    const brakes = [event('brake', 600, 100, 610), event('brake', 1200, 100, 1210)];
    const samples = simulate(1500, offLine);
    const run = runCoach(steady, brakes, samples);
    expect(decisionFor(run, 'brake@600')).toBe('suspended');
    expect(decisionFor(run, 'brake@1200')).toBe('cue');
    expect(run.cues.filter(decision => decision.cue.eventKey === 'brake@600')).toEqual([]);
    const back = run.matches.findIndex((match, index) => index > 0 && match?.trusted === true && run.matches[index - 1]?.trusted !== true);
    expect(samples[back]!.position.x).toBeGreaterThan(700);
    const resumed = run.cues.find(decision => decision.cue.kind === 'guidance-resumed')!;
    expect(resumed.cue.decidedMonoMs - samples[back]!.receivedMonoMs).toBeGreaterThanOrEqual(1000);
    expect(resumed.cue.decidedMonoMs - samples[back]!.receivedMonoMs).toBeLessThan(1050);
    expect(run.guidance.map(entry => entry.state)).toEqual([
      { mode: 'active', reason: null },
      { mode: 'suspended', reason: 'untrusted-position' },
      { mode: 'active', reason: null }
    ]);
  });

  it('guidance_phrases_only_after_a_suspension_of_2_s_and_never_delay_brake', () => {
    const steady = flatPath(2000, () => 150);
    const brakes = [event('brake', 1200, 100, 1210)];
    const withoutSideCues = { sideCueDistanceM: null };
    const offLineBetween = (fromM: number, toM: number) => simulate(1500, sM => ({ speedKph: 150, lateralM: sM >= fromM && sM < toM ? 9 : 0 }));

    const long = offLineBetween(300, 500);
    const farFromBrake = runCoach(steady, brakes, long, withoutSideCues);
    expect(farFromBrake.cues.map(decision => decision.cue.kind)).toEqual(['guidance-paused', 'guidance-resumed', 'brake']);
    expect(farFromBrake.cues[0]!.cue).toMatchObject({ clip: 'guidance-paused', priority: 10, targetSpeedKph: null });
    const firstUntrusted = farFromBrake.matches.findIndex(match => match?.trusted !== true);
    const pausedAfterMs = farFromBrake.cues[0]!.cue.decidedMonoMs - long[firstUntrusted]!.receivedMonoMs;
    expect(pausedAfterMs).toBeGreaterThanOrEqual(2000);
    expect(pausedAfterMs).toBeLessThan(2040);

    const short = runCoach(steady, brakes, offLineBetween(300, 400), withoutSideCues);
    expect(short.cues.map(decision => decision.cue.kind)).toEqual(['brake']);
    expect(short.guidance.map(entry => entry.state.mode)).toEqual(['active', 'suspended', 'active']);

    const nearBrake = runCoach(steady, brakes, offLineBetween(300, 1120), withoutSideCues);
    expect(nearBrake.cues.map(decision => decision.cue.kind)).toEqual(['guidance-paused', 'brake']);
    expect(nearBrake.guidance.at(-1)!.state).toEqual({ mode: 'active', reason: null });
    const brake = nearBrake.cues.at(-1)!.cue;
    const reached = simulate(1500, () => ({ speedKph: 150 })).find(sample => sample.position.x >= 1200)!;
    expect(reached.receivedMonoMs - brake.decidedMonoMs).toBeGreaterThanOrEqual(60 + 500);
  });

  describe('side cues', () => {
    const steady = flatPath(1500, () => 150);
    const aside = (lateralM: number, fromM = 300, toM = 1500) =>
      simulate(800, sM => ({ speedKph: 150, lateralM: sM >= fromM && sM < toM ? lateralM : 0 }));
    const sideKinds = (run: ReturnType<typeof runCoach>) =>
      run.cues.filter(decision => decision.cue.kind === 'keep-left' || decision.cue.kind === 'keep-right').map(decision => decision.cue.kind);

    it('side_cues_are_enabled_by_default', () => {
      expect(DEFAULT_SIDE_CUE_DISTANCE_M).toBe(2);
    });

    it('side_cue_below_the_distance_is_silent', () => {
      expect(runCoach(steady, [], aside(0.9), { sideCueDistanceM: 1 }).cues).toEqual([]);
      expect(runCoach(steady, [], aside(-0.9), { sideCueDistanceM: 1 }).cues).toEqual([]);
    });

    it('side_cue_above_the_distance_after_300_ms', () => {
      const right = aside(1.1);
      const run = runCoach(steady, [], right, { sideCueDistanceM: 1 });
      expect(sideKinds(run)).toEqual(['keep-left']);
      const cue = run.cues[0]!.cue;
      const firstOff = right.findIndex(sample => sample.position.z > 1);
      expect(cue.decidedMonoMs - right[firstOff]!.receivedMonoMs).toBeGreaterThanOrEqual(300);
      expect(cue.decidedMonoMs - right[firstOff]!.receivedMonoMs).toBeLessThan(320);
      expect(cue).toMatchObject({ clip: 'keep-left', priority: 50, followClip: null, targetSpeedKph: null });
      expect(sideKinds(runCoach(steady, [], aside(-1.1), { sideCueDistanceM: 1 }))).toEqual(['keep-right']);
      expect(runCoach(steady, [], aside(1.1, 300, 310), { sideCueDistanceM: 1 }).cues).toEqual([]);
    });

    it('side_cue_once_per_excursion', () => {
      expect(sideKinds(runCoach(steady, [], aside(1.2), { sideCueDistanceM: 1 }))).toEqual(['keep-left']);
      const twice = simulate(1200, sM => ({ speedKph: 150, lateralM: (sM >= 300 && sM < 500) || (sM >= 700 && sM < 900) ? 1.2 : 0 }));
      expect(sideKinds(runCoach(steady, [], twice, { sideCueDistanceM: 1 }))).toEqual(['keep-left', 'keep-left']);
    });

    it('side_cue_off_gives_no_side_cue', () => {
      expect(runCoach(steady, [], aside(2.5), { sideCueDistanceM: null }).cues).toEqual([]);
    });

    it('side_cue_distance_follows_the_setting', () => {
      expect(runCoach(steady, [], aside(1.6), { sideCueDistanceM: 2 }).cues).toEqual([]);
      expect(sideKinds(runCoach(steady, [], aside(1.6), { sideCueDistanceM: 1.5 }))).toEqual(['keep-left']);
    });

    it('muted_side_cue_stays_muted', () => {
      const run = runCoach(steady, [], aside(1.2), { sideCueDistanceM: 1, mutedKeys: new Set(['keep-left']) });
      expect(run.cues).toEqual([]);
      expect(run.suppressed.map(entry => entry.why)).toEqual(['muted']);
    });

    it('side_cue_is_silent_between_turn_in_and_apex', () => {
      const bendEvents: ReferenceCueEvent[] = [event('brake', 60, 50, 90), event('throttle', 150, null)];
      const corner = findCorners(bendPath(1), bendEvents, DEFAULT_CONFIG)[0]!;
      const sideRun = (fromM: number, toM: number) =>
        runCoach(bendPath(1), bendEvents, drive(bendWaypoints(1, 20, sM => (sM >= fromM && sM <= toM ? 1.5 : 0))), { sideCueDistanceM: 1 });
      const sides = (run: ReturnType<typeof runCoach>) =>
        run.cues.filter(decision => decision.cue.kind === 'keep-left' || decision.cue.kind === 'keep-right');
      expect(sides(sideRun(corner.turnInSM, corner.apexSM - 5))).toEqual([]);
      expect(sides(sideRun(10, 45))).toHaveLength(1);
      const pastApex = sides(sideRun(corner.turnInSM, corner.apexSM + 40));
      expect(pastApex).toHaveLength(1);
      expect(pastApex[0]!.sM!).toBeGreaterThan(corner.apexSM);
    });

    it('side_cue_yields_to_a_brake_cue', () => {
      const brake = [event('brake', 600, 100, 610)];
      const brakeTime = (fromM: number | null) => {
        const samples = simulate(900, sM => ({ speedKph: 150, lateralM: fromM !== null && sM >= fromM ? 1.2 : 0 }));
        const run = runCoach(steady, brake, samples, { sideCueDistanceM: 1 });
        const side = run.suppressed.find(entry => entry.eventKey.startsWith('keep-left@'));
        return { decidedMonoMs: run.cues.find(decision => decision.cue.eventKey === 'brake@600')?.cue.decidedMonoMs, why: side?.why };
      };
      const baseline = brakeTime(null).decidedMonoMs;
      expect(baseline).toBeDefined();
      const outcomes = new Set<string | undefined>();
      for (let fromM = 540; fromM <= 580; fromM += 0.25) {
        const result = brakeTime(fromM);
        expect(result.decidedMonoMs, String(fromM)).toBe(baseline);
        outcomes.add(result.why);
      }
      expect(outcomes).toContain('lower-priority');
      expect(outcomes).toContain('cooldown');
    });
  });

  it('ttl_is_150_plus_device_delay', () => {
    for (const deviceDelayMs of [0, 60, 240]) {
      const run = runCoach(brakePath, [brake600], simulate(900, followReference()), { deviceDelayMs });
      expect(run.cues[0]!.cue.ttlMs).toBe(150 + deviceDelayMs);
    }
  });

  it('end_of_section_waits_for_restart', () => {
    const run = runCoach(brakePath, [brake600], simulate(2000.4, followReference()));
    expect(run.guidance.at(-1)!.state).toEqual({ mode: 'waiting-for-restart', reason: 'awaiting-restart' });
  });

  it('golden_trace_is_stable', () => {
    const golden = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../fixtures/golden/ce-slow-cues.json', import.meta.url)), 'utf8')
    );
    const trace = replayCoach(slowRun, analysisOf(path, events), DEFAULT_CONFIG, {
      deviceDelayMs: 60,
      phraseMs: estimatedPhraseMs,
      mutedKeys: new Set(),
      speakTargets: true,
      offsetsMs: new Map(),
      sideCueDistanceM: DEFAULT_SIDE_CUE_DISTANCE_M
    });
    expect(JSON.parse(JSON.stringify(trace))).toEqual(golden.trace);
  });

  it('trace_rounds_distance_to_a_centimetre_and_times_to_a_millisecond', () => {
    const trace = replayCoach(slowRun, analysisOf(path, events), DEFAULT_CONFIG, {
      deviceDelayMs: 60,
      phraseMs: estimatedPhraseMs,
      mutedKeys: new Set(),
      speakTargets: true,
      offsetsMs: new Map(),
      sideCueDistanceM: DEFAULT_SIDE_CUE_DISTANCE_M
    });
    expect(trace.cues.length).toBeGreaterThan(0);
    for (const cue of trace.cues) {
      expect(Number.isInteger(cue.decidedMonoMs)).toBe(true);
      expect(Number.isInteger(cue.ttlMs)).toBe(true);
      expect(cue.sM === null || Math.abs(cue.sM * 100 - Math.round(cue.sM * 100)) < 1e-6).toBe(true);
    }
  });

  it('golden_trace_at_1_m_speaks_side_cues', () => {
    const golden = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../fixtures/golden/ce-slow-cues-side-1m.json', import.meta.url)), 'utf8')
    );
    const trace = replayCoach(slowRun, analysisOf(path, events), DEFAULT_CONFIG, {
      deviceDelayMs: 60,
      phraseMs: estimatedPhraseMs,
      mutedKeys: new Set(),
      speakTargets: true,
      offsetsMs: new Map(),
      sideCueDistanceM: 1
    });
    expect(golden.sideCueDistanceM).toBe(1);
    expect(trace.cues.filter(cue => cue.kind === 'keep-left' || cue.kind === 'keep-right').map(cue => cue.id)).toEqual([
      '1:keep-left@406',
      '1:keep-right@685'
    ]);
    expect(JSON.parse(JSON.stringify(trace))).toEqual(golden.trace);
  });

  it('every_muteable_cue_has_one_mute_key', () => {
    const run = runCoach(path, events, attempt, { deviceDelayMs: 60, sideCueDistanceM: 1 });
    const muteKeys = new Set([...events.map(entry => entry.key), 'tighter', 'keep-left', 'keep-right']);
    const targets = [...run.cues.map(decision => decision.target), ...run.suppressed.map(entry => entry.target)];
    const muteable = targets.filter(target => target.eventKind !== 'guidance');
    expect(new Set(muteable.map(target => target.eventKind))).toEqual(new Set(['brake', 'big-stop', 'ease-off', 'throttle', 'keep-left', 'keep-right']));
    for (const target of muteable) expect(target.muteKey !== null && muteKeys.has(target.muteKey), JSON.stringify(target)).toBe(true);
    const bigStop = muteable.find(target => target.eventKind === 'big-stop')!;
    expect(bigStop.muteKey).toBe(events.find(entry => entry.bigStop)!.key);
    expect(targets.filter(target => target.eventKind === 'guidance').every(target => target.muteKey === null)).toBe(true);
  });

  it('slow_run_speaks_action_phrases', () => {
    const run = runCoach(path, events, attempt, { deviceDelayMs: 60 });
    const brakes = run.cues.filter(decision => decision.target.eventKind === 'brake').map(decision => decision.cue);
    expect(brakes.map(cue => [cue.kind, cue.clip, cue.followClip])).toEqual([['hard-brake', 'hard-brake', 'speed-115']]);
    const throttles = run.cues.filter(decision => decision.target.eventKind === 'throttle').map(decision => decision.cue);
    expect(throttles.every(cue => cue.followClip === null)).toBe(true);
    expect(throttles.every(cue => cue.clip === 'full-throttle' || cue.clip === 'throttle')).toBe(true);
  });

  it('speak_targets_off_gives_no_follow_clip', () => {
    const run = runCoach(path, events, attempt, { deviceDelayMs: 60, speakTargets: false });
    const brakes = run.cues.filter(decision => decision.target.eventKind === 'brake');
    expect(brakes).toHaveLength(1);
    expect(brakes.every(decision => decision.cue.followClip === null)).toBe(true);
    expect(brakes.map(decision => decision.cue.targetSpeedKph)).toEqual([115]);
  });

  describe('timing offset', () => {
    const steady = flatPath(2000, () => 150);
    const samples = simulate(1500, () => ({ speedKph: 150 }));
    const twoBrakes = [event('brake', 600, 100, 610), event('brake', 1200, 100, 1210)];
    const decided = (offsetsMs: ReadonlyMap<string, number>) => {
      const run = runCoach(steady, twoBrakes, samples, { offsetsMs });
      return Object.fromEntries(run.cues.map(decision => [decision.cue.eventKey, decision.cue]));
    };

    it('offset_moves_one_cue_only', () => {
      const base = decided(new Map());
      const earlier = decided(new Map([['brake@600', 800]]));
      const later = decided(new Map([['brake@600', -500]]));
      expect(Math.abs(base['brake@600']!.decidedMonoMs - earlier['brake@600']!.decidedMonoMs - 800)).toBeLessThanOrEqual(20);
      expect(earlier['brake@1200']!.decidedMonoMs).toBe(base['brake@1200']!.decidedMonoMs);
      expect(Math.abs(later['brake@600']!.decidedMonoMs - base['brake@600']!.decidedMonoMs - 500)).toBeLessThanOrEqual(20);
    });

    it('offset_keeps_brake_priority', () => {
      const run = runCoach(steady, [event('brake', 600, 100, 610), event('ease-off', 640, null)], samples, {
        offsetsMs: new Map([['ease-off@640', 1000]])
      });
      expect(run.cues.map(decision => [decision.cue.eventKey, decision.cue.priority])).toEqual([
        ['ease-off@640', 90],
        ['brake@600', 100]
      ]);
    });
  });

  describe('big stop', () => {
    const fast = flatPath(2000, () => 250);
    const bigBrake = event('brake', 1200, 85, 1300, { voice: 'hard-brake', bigStop: true });
    const cruising = simulate(1500, () => ({ speedKph: 250 }));
    const reachMs = cruising.find(sample => sample.position.x >= 1200)!.receivedMonoMs;

    it('big_stop_comes_about_2_s_before_the_first_brake', () => {
      const trace = replayCoach(slowRun, analysisOf(path, events), DEFAULT_CONFIG, {
        deviceDelayMs: 60,
        phraseMs: estimatedPhraseMs,
        mutedKeys: new Set(),
        speakTargets: true,
        offsetsMs: new Map(),
        sideCueDistanceM: DEFAULT_SIDE_CUE_DISTANCE_M
      });
      const keys = trace.cues.map(cue => cue.id.split(':')[1]);
      expect(keys.indexOf('big-stop@291')).toBeGreaterThanOrEqual(0);
      expect(keys.indexOf('big-stop@291')).toBeLessThan(keys.indexOf('brake@291'));
      const bigStop = trace.cues.find(cue => cue.id.endsWith(':big-stop@291'))!;
      expect(bigStop).toMatchObject({ kind: 'big-stop', clip: 'big-stop', followClip: null, priority: 95 });
      const cleanAttempt = between(samplesOf('ce-clean'), 8451, 9479);
      const run = runCoach(path, events, cleanAttempt, { deviceDelayMs: 60 });
      const decided = run.cues.find(decision => decision.cue.eventKey === 'big-stop@291')!;
      const reached = cleanAttempt.find((_, index) => (run.matches[index]?.sM ?? 0) >= 291)!;
      const leadMs = reached.receivedMonoMs - decided.cue.decidedMonoMs;
      expect(leadMs).toBeGreaterThanOrEqual(1900 + 60);
      expect(leadMs).toBeLessThanOrEqual(2100 + 60);
    });

    it('big_stop_lead_is_device_delay_plus_2_s', () => {
      const run = runCoach(fast, [bigBrake], cruising, { deviceDelayMs: 60 });
      expect(run.cues.map(decision => decision.cue.eventKey)).toEqual(['big-stop@1200', 'brake@1200']);
      const leadMs = reachMs - run.cues[0]!.cue.decidedMonoMs;
      expect(leadMs).toBeGreaterThanOrEqual(2060);
      expect(leadMs).toBeLessThan(2060 + 40);
    });

    it('offset_moves_the_big_stop_with_its_brake', () => {
      const base = runCoach(fast, [bigBrake], cruising).cues[0]!.cue.decidedMonoMs;
      const moved = runCoach(fast, [bigBrake], cruising, { offsetsMs: new Map([['brake@1200', 500]]) }).cues[0]!;
      expect(moved.cue.eventKey).toBe('big-stop@1200');
      expect(Math.abs(base - moved.cue.decidedMonoMs - 500)).toBeLessThanOrEqual(20);
    });

    it('big_stop_never_delays_brake', () => {
      const matcher = new Matcher(fast, DEFAULT_CONFIG);
      const coach = new Coach(analysisOf(fast, [bigBrake]), DEFAULT_CONFIG, settingsOf());
      const lateStart = reachMs - 600;
      const cues: string[] = [];
      const suppressed: string[] = [];
      for (const sample of cruising) {
        const match = matcher.step(sample);
        if (sample.receivedMonoMs < lateStart) continue;
        const output = coach.step({
          sample,
          match,
          nowMonoMs: sample.receivedMonoMs,
          generation: 0,
          deviceDelayMs: 60,
          phraseMs: estimatedPhraseMs
        });
        if (output.cue) cues.push(output.cue.eventKey);
        suppressed.push(...output.suppressed.map(entry => `${entry.eventKey}:${entry.why}`));
      }
      expect(cues).toEqual(['brake@1200']);
      expect(suppressed).toContain('big-stop@1200:too-late');
    });

    it('big_stop_never_drops_an_ease_off', () => {
      const liftThenStop = [event('ease-off', 1100, null), bigBrake];
      const run = runCoach(fast, liftThenStop, cruising, { deviceDelayMs: 60 });
      expect(run.cues.map(decision => decision.cue.eventKey)).toEqual(['ease-off@1100', 'brake@1200']);
      expect(decisionFor(run, 'big-stop@1200')).not.toBe('cue');
    });

    it('big_stop_never_cuts_an_ease_off', () => {
      const liftThenStop = [event('ease-off', 1080, null), bigBrake];
      const run = runCoach(fast, liftThenStop, cruising, { deviceDelayMs: 60 });
      expect(run.cues.map(decision => decision.cue.eventKey)).toEqual(['ease-off@1080', 'brake@1200']);
      expect(decisionFor(run, 'big-stop@1200')).not.toBe('cue');
    });

    it('big_stop_still_comes_well_after_an_ease_off', () => {
      const run = runCoach(fast, [event('ease-off', 900, null), bigBrake], cruising, { deviceDelayMs: 60 });
      expect(run.cues.map(decision => decision.cue.eventKey)).toEqual(['ease-off@900', 'big-stop@1200', 'brake@1200']);
    });

    it('muted_brake_mutes_its_big_stop', () => {
      const run = runCoach(fast, [bigBrake], cruising, { mutedKeys: new Set(['brake@1200']) });
      expect(run.cues).toEqual([]);
      expect(decisionFor(run, 'big-stop@1200')).toBe('muted');
    });
  });

  it('throttle_with_less_than_the_device_delay_left_is_too_late', () => {
    const fastPath = flatPath(2000, () => 250);
    const samples = simulate(1500, () => ({ speedKph: 250, throttle: 0.3 }));
    const run = runCoach(fastPath, [event('throttle', 1200, 250)], samples, {
      offsetsMs: new Map([['throttle@1200', -500]]),
      input: input => ({ ...input, deviceDelayMs: input.sample.position.x > 1180 ? 1000 : 60 })
    });
    expect(run.cues).toEqual([]);
    expect(decisionFor(run, 'throttle@1200')).toBe('too-late');
  });

  describe('full throttle', () => {
    const steady = flatPath(1500, () => 150);
    const full = [event('throttle', 600, 150, null, { voice: 'full-throttle' })];
    const slowWith = (throttle: number, brake = 0) => simulate(1000, () => ({ speedKph: 120, throttle, brake }));

    it('full_throttle_needs_the_player_below_095', () => {
      expect(decisionFor(runCoach(steady, full, slowWith(0.96)), 'throttle@600')).toBe('already-full');
      const run = runCoach(steady, full, slowWith(0.5));
      expect(run.cues[0]!.cue).toMatchObject({ kind: 'full-throttle', clip: 'full-throttle', followClip: null, priority: 20 });
    });

    it('full_throttle_never_while_braking', () => {
      expect(decisionFor(runCoach(steady, full, slowWith(0, 0.2)), 'throttle@600')).toBe('acceleration-unsafe');
    });

    it('throttle_without_target_still_speaks', () => {
      const run = runCoach(steady, [event('throttle', 600, null)], slowWith(0.3));
      expect(run.cues[0]!.cue).toMatchObject({ kind: 'throttle', clip: 'throttle', targetSpeedKph: null });
    });
  });

  describe('Closer to apex', () => {
    const bendEvents: ReferenceCueEvent[] = [event('brake', 60, 50, 90), event('throttle', 150, null)];
    const bendCorner = (bend: 1 | -1): Corner => findCorners(bendPath(bend), bendEvents, DEFAULT_CONFIG)[0]!;
    const corner = bendCorner(1);
    const tighterRun = (outsideM: (sM: number) => number, options: Parameters<typeof runCoach>[3] = {}, bend: 1 | -1 = 1) =>
      runCoach(bendPath(bend), bendEvents, drive(bendWaypoints(bend, 20, outsideM)), options);
    const between = (fromM: number, toM: number, sizeM: number) => (sM: number) => (sM >= fromM && sM <= toM ? sizeM : 0);
    const tighterCues = (run: ReturnType<typeof runCoach>) => run.cues.filter(decision => decision.cue.kind === 'tighter');

    it('corner_lies_on_the_bend', () => {
      expect(corner.turnInSM).toBeGreaterThan(100);
      expect(corner.apexSM - corner.turnInSM).toBeGreaterThan(30);
    });

    it('tighter_when_outside_before_the_apex', () => {
      for (const bend of [1, -1] as const) {
        const shape = bendCorner(bend);
        const run = tighterRun(between(shape.turnInSM, shape.apexSM - 5, 2.5), {}, bend);
        expect(tighterCues(run).map(decision => [decision.cue.eventKey, decision.cue.clip, decision.cue.priority])).toEqual([
          ['tighter@1', 'tighter', 50]
        ]);
        const at = tighterCues(run)[0]!.sM!;
        expect(at).toBeGreaterThan(shape.turnInSM);
        expect(at).toBeLessThan(shape.apexSM);
      }
      expect(tighterCues(tighterRun(between(corner.turnInSM, corner.apexSM - 5, 1.9)))).toEqual([]);
      expect(tighterCues(tighterRun(between(corner.turnInSM, corner.apexSM - 5, -2.5)))).toEqual([]);
      expect(tighterCues(tighterRun(between(corner.apexSM + 1, corner.apexSM + 40, 2.5)))).toEqual([]);
    });

    it('tighter_once_per_corner', () => {
      const middle = (corner.turnInSM + corner.apexSM) / 2;
      const twice = (sM: number) => (sM >= corner.turnInSM && sM < middle - 4) || (sM > middle + 2 && sM < corner.apexSM) ? 2.5 : 0;
      expect(tighterCues(tighterRun(twice))).toHaveLength(1);
    });

    it('no_tighter_when_untrusted_or_suspended', () => {
      const outside = between(corner.turnInSM, corner.apexSM - 5, 2.5);
      const untrusted = tighterRun(outside, {
        input: input => (input.match ? { ...input, match: { ...input.match, trusted: input.match.sM < corner.turnInSM - 30 } } : input)
      });
      expect(tighterCues(untrusted)).toEqual([]);
      const muted = tighterRun(outside, { mutedKeys: new Set(['tighter']) });
      expect(tighterCues(muted)).toEqual([]);
      expect(decisionFor(muted, 'tighter@1')).toBe('muted');
    });

    it('brake_beats_tighter_and_big_stop', () => {
      const brakeAtApex = [...bendEvents, event('brake', 160, 50, 170)];
      const target = findCorners(bendPath(1), brakeAtApex, DEFAULT_CONFIG)[0]!;
      const brakeTime = (outside: (sM: number) => number) => {
        const run = runCoach(bendPath(1), brakeAtApex, drive(bendWaypoints(1, 20, outside)));
        const brake = run.cues.find(decision => decision.cue.eventKey === 'brake@160');
        return { decidedMonoMs: brake?.cue.decidedMonoMs, tighter: decisionFor(run, `tighter@${target.number}`) };
      };
      const baseline = brakeTime(() => 0).decidedMonoMs;
      expect(baseline).toBeDefined();
      const outcomes = new Set<string>();
      for (let fromM = Math.ceil(target.turnInSM); fromM <= 150; fromM += 0.5) {
        const result = brakeTime(between(fromM, target.apexSM - 1, 2.5));
        expect(result.decidedMonoMs, String(fromM)).toBe(baseline);
        outcomes.add(result.tighter);
      }
      expect(outcomes).toContain('lower-priority');

      const fast = flatPath(2000, () => 250);
      const close = [event('brake', 1200, 85, 1300, { voice: 'hard-brake', bigStop: true })];
      const cues = runCoach(fast, close, simulate(1500, () => ({ speedKph: 250 }))).cues.map(decision => decision.cue);
      expect(cues.map(cue => cue.eventKey)).toEqual(['big-stop@1200', 'brake@1200']);
      expect(cues[1]!.decidedMonoMs - cues[0]!.decidedMonoMs).toBeLessThan(DEFAULT_CONFIG.cue.cooldownMs);
    });
  });
});

