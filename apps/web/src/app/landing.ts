import type { LiveMode } from '@gt7/contracts';

export type Landing = 'get-ready' | 'drive' | 'exercises';

const DRIVING_MODES: LiveMode[] = ['armed', 'driving', 'paused'];

export function landing(input: { ps5Ip: string | null; liveMode: LiveMode | null; demo: boolean }): Landing {
  if (input.liveMode !== null && DRIVING_MODES.includes(input.liveMode)) return 'drive';
  if (input.demo) return 'exercises';
  if (input.ps5Ip === null) return 'get-ready';
  return 'exercises';
}
