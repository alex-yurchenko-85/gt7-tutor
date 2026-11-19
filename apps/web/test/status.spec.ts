import { describe, expect, it } from 'vitest';
import { telemetryStatus } from '../src/app/status.ts';
import { liveState } from './support.tsx';

describe('telemetry status', () => {
  it('idle_server_says_no_data_and_no_training', () => {
    expect(telemetryStatus(liveState({ mode: 'idle' }), true).text).toBe('No data from the console. No training runs.');
  });

  it('demo_waiting_text_is_the_same_as_on_drive', () => {
    expect(telemetryStatus(liveState({ mode: 'armed', connection: 'stale' }), true, true).text).toBe('Waiting for the recorded data.');
  });
});
