import { describe, expect, it } from 'vitest';
import { setWantsVoice, voiceDeviceId, wantsVoice } from '../src/voice/device.ts';

describe('voice device identity', () => {
  it('voice_device_id_belongs_to_one_tab', () => {
    window.localStorage.setItem('gt7.voiceDeviceId', 'shared-by-every-tab');
    const id = voiceDeviceId();
    expect(id).not.toBe('shared-by-every-tab');
    expect(window.sessionStorage.getItem('gt7.voiceDeviceId')).toBe(id);
    expect(voiceDeviceId()).toBe(id);
  });

  it('wanting_voice_is_per_tab', () => {
    setWantsVoice(true);
    expect(window.localStorage.getItem('gt7.wantsVoice')).toBeNull();
    expect(wantsVoice()).toBe(true);
  });
});
