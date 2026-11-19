import { describe, expect, it } from 'vitest';
import { consoleState, voiceState } from '../src/app/status.ts';
import { liveState } from './support.tsx';

describe('readiness', () => {
  it('console_state_follows_address_and_telemetry', () => {
    expect(consoleState(null, null, false, true)).toBe('recorded-data');
    expect(consoleState(null, null, true, false)).toBe('no-address');
    expect(consoleState('10.0.0.5', liveState({ connection: 'connected' }), true, false)).toBe('receiving');
    expect(consoleState('10.0.0.5', liveState({ connection: 'connected' }), false, false)).toBe('address-saved');
    expect(consoleState('10.0.0.5', liveState({ connection: 'stale' }), true, false)).toBe('address-saved');
  });

  it('voice_state_names_the_holder', () => {
    expect(voiceState(null, 'here')).toBe('none');
    expect(voiceState(liveState({ voiceDeviceId: null }), 'here')).toBe('none');
    expect(voiceState(liveState({ voiceDeviceId: 'phone' }), 'here')).toBe('elsewhere');
    expect(voiceState(liveState({ voiceDeviceId: 'here', voiceReady: true }), 'here')).toBe('here');
    expect(voiceState(liveState({ voiceDeviceId: 'here', voiceReady: false }), 'here')).toBe('here-not-ready');
  });
});
