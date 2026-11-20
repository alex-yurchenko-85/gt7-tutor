import type { SetupSection } from '../../app/router.tsx';

export function defaultSection(ps5Ip: string | null, demo: boolean, voiceDeviceId: string | null): SetupSection {
  if (ps5Ip === null && !demo) return 'console';
  if (voiceDeviceId === null) return 'voice';
  return 'profiles';
}
