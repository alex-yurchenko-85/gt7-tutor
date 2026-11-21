import { ENGLISH, type Sample } from '@gt7/contracts';
import { describe, expect, it } from 'vitest';
import type { CoachSettings } from '../src/coach.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { estimatedPhraseMs } from '../src/cue-text.ts';
import { startMissed, type StartWatch } from '../src/missed-start.ts';
import { TrainingRun } from '../src/training-run.ts';
import { samplesOf, type FixtureName } from './fixtures.ts';
import { interlagosAnalysis } from './paths.ts';

const englishPhraseMs = (clip: string) => estimatedPhraseMs(ENGLISH, clip);

const settings: CoachSettings = { mutedKeys: new Set(), speakTargets: false, offsetsMs: new Map(), sideCueDistanceM: null };

const now = { deviceDelayMs: 60, phraseMs: englishPhraseMs };

type Prompts = { ranges: [number, number][]; starts: number[] };

function promptsOf(samples: Sample[]): Prompts {
  const run = new TrainingRun(interlagosAnalysis(), DEFAULT_CONFIG, settings, { nextGeneration: () => 1 });
  const ranges: [number, number][] = [];
  const starts: number[] = [];
  let open = false;
  for (const sample of samples) {
    const step = run.step(sample, now);
    for (const event of step.attemptEvents) if (event.type === 'started') starts.push(sample.rawIndex);
    if (step.startMissed && open) ranges.at(-1)![1] = sample.rawIndex;
    else if (step.startMissed) ranges.push([sample.rawIndex, sample.rawIndex]);
    open = step.startMissed;
  }
  return { ranges, starts };
}

function armedFrom(name: FixtureName, rawIndex: number): Sample[] {
  return samplesOf(name).filter(sample => sample.rawIndex >= rawIndex);
}

function session(names: FixtureName[]): Sample[] {
  return names.map(samplesOf).reduce((all, next) => all.concat(next.filter(sample => sample.rawIndex > all.at(-1)!.rawIndex)));
}

const IDLE: StartWatch = { attemptRunning: false, attemptRunEnded: false, previousTimerMs: 1000 };

describe('startMissed', () => {
  it('running_player_timer_without_an_attempt_is_a_missed_start', () => {
    expect(startMissed(IDLE, { playerSession: true, gameTimerMs: 1017 })).toBe(true);
  });

  it('no_prompt_when_a_condition_is_false', () => {
    const cases: [Partial<StartWatch>, Pick<Sample, 'playerSession' | 'gameTimerMs'>][] = [
      [{ attemptRunning: true }, { playerSession: true, gameTimerMs: 1017 }],
      [{ attemptRunEnded: true }, { playerSession: true, gameTimerMs: 1017 }],
      [{}, { playerSession: false, gameTimerMs: 1017 }],
      [{}, { playerSession: true, gameTimerMs: 1000 }],
      [{}, { playerSession: true, gameTimerMs: -1 }],
      [{}, { playerSession: true, gameTimerMs: 0 }],
      [{ previousTimerMs: null }, { playerSession: true, gameTimerMs: 1017 }],
      [{ previousTimerMs: 0 }, { playerSession: true, gameTimerMs: 15839 }],
      [{ previousTimerMs: -1 }, { playerSession: true, gameTimerMs: 9050 }]
    ];
    for (const [state, sample] of cases) expect(startMissed({ ...IDLE, ...state }, sample), JSON.stringify([state, sample])).toBe(false);
  });

  it('pause_run_armed_before_the_start_gives_no_prompt', () => {
    expect(promptsOf(samplesOf('ce-pause'))).toEqual({ ranges: [], starts: [11565] });
  });

  it('licence_run_armed_in_the_middle_gives_the_prompt_while_the_timer_runs', () => {
    expect(promptsOf(armedFrom('b3-run', 6000))).toEqual({ ranges: [[6001, 6442]], starts: [] });
  });

  it('background_timer_gives_no_prompt', () => {
    expect(promptsOf(armedFrom('ce-off-track-end', 14881))).toEqual({ ranges: [], starts: [] });
  });

  it('timer_after_a_left_track_abort_gives_no_prompt', () => {
    expect(promptsOf(samplesOf('ce-off-track-end'))).toEqual({ ranges: [], starts: [14386] });
    expect(promptsOf(samplesOf('ce-off-track-reset'))).toEqual({ ranges: [], starts: [7433] });
  });

  it('finished_runs_give_no_prompt_on_the_result_screen', () => {
    for (const name of ['b1-run', 'b3-run', 'ce-clean', 'ce-slow'] as const) expect(promptsOf(samplesOf(name)).ranges, name).toEqual([]);
    expect(promptsOf(session(['ce-off-track-reset', 'ce-clean', 'ce-pause', 'ce-off-track-end'])).ranges).toEqual([]);
  });

  it('pause_hides_the_prompt_of_a_missed_run', () => {
    expect(promptsOf(armedFrom('ce-pause', 11600))).toEqual({ ranges: [[11601, 11650], [12348, 13306]], starts: [] });
  });

  it('prompt_clears_when_the_timer_restarts_from_zero', () => {
    const samples = session(['ce-off-track-reset', 'ce-clean']).filter(sample => sample.rawIndex >= 7500);
    expect(promptsOf(samples)).toEqual({ ranges: [[7501, 7973], [7976, 8065]], starts: [8452] });
  });
});
