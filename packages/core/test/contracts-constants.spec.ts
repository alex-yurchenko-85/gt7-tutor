import { RECURRING_MIN_ATTEMPTS, WIDE_APEX_M } from '@gt7/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.ts';

describe('contracts constants match core config', () => {
  it('contracts_constants_match_core_config', () => {
    expect(DEFAULT_CONFIG.corners.wideApexM).toBe(WIDE_APEX_M);
    expect(DEFAULT_CONFIG.recurring.minAttempts).toBe(RECURRING_MIN_ATTEMPTS);
  });
});
