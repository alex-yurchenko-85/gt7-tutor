import { describe, expect, it } from 'vitest';
import { landing } from '../src/app/landing.ts';

const READY = { ps5Ip: '192.0.2.10', liveMode: 'idle' as const, exerciseCount: 2, demo: false };

describe('landing', () => {
  it('armed_driving_and_paused_land_on_drive', () => {
    for (const liveMode of ['armed', 'driving', 'paused'] as const) expect(landing({ ...READY, liveMode })).toBe('drive');
  });

  it('missing_console_address_gets_ready', () => {
    expect(landing({ ...READY, ps5Ip: null })).toBe('get-ready');
  });

  it('no_exercise_gets_ready', () => {
    expect(landing({ ...READY, exerciseCount: 0 })).toBe('get-ready');
  });

  it('otherwise_exercises', () => {
    expect(landing(READY)).toBe('exercises');
    expect(landing({ ...READY, liveMode: null })).toBe('exercises');
    expect(landing({ ...READY, liveMode: 'finished' })).toBe('exercises');
  });

  it('drive_wins_over_get_ready', () => {
    expect(landing({ ps5Ip: null, liveMode: 'driving', exerciseCount: 0, demo: false })).toBe('drive');
  });

  it('demo_never_gets_ready', () => {
    expect(landing({ ...READY, demo: true, ps5Ip: null })).toBe('exercises');
    expect(landing({ ...READY, demo: true, exerciseCount: 0 })).toBe('exercises');
  });
});
