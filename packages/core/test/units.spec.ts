import { KPH_PER_MPS } from '@gt7/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { kph } from '../src/units.ts';

describe('units', () => {
  it('kph_converts_to_metres_per_second', () => {
    expect(kph(36)).toBe(10);
    expect(kph(0)).toBe(0);
    expect(kph(88.6) * KPH_PER_MPS).toBeCloseTo(88.6, 12);
    expect(DEFAULT_CONFIG.voice).toMatchObject({ hardBrakeLossMps: kph(60), lightBrakeLossMps: kph(25), bigStopEntryMps: kph(200), bigStopLossMps: kph(100) });
    expect(DEFAULT_CONFIG.incompatibleOverspeedMps).toBe(kph(15));
    expect(DEFAULT_CONFIG.findings.slowCornerMps).toBe(kph(8));
    expect(DEFAULT_CONFIG.target.roundDownKph).toBe(5);
  });
});
