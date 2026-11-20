import { describe, expect, it } from 'vitest';
import { formatDateTime, formatGap, signedSeconds } from '../src/app/format.ts';

describe('format', () => {
  it('signed_seconds_rounds_and_has_no_sign_at_zero', () => {
    expect(signedSeconds(1630)).toBe('+1.63');
    expect(signedSeconds(-300)).toBe('\u22120.30');
    expect(signedSeconds(4)).toBe('0.00');
    expect(signedSeconds(-4)).toBe('0.00');
    expect(signedSeconds(1630, 1)).toBe('+1.6');
    expect(signedSeconds(-40, 1)).toBe('0.0');
  });

  it('format_gap_uses_signed_seconds', () => {
    expect(formatGap(null)).toBe('');
    expect(formatGap(0)).toBe('best');
    expect(formatGap(1630)).toBe('+1.63 s');
  });

  it('format_date_time_has_short_month_year_and_time', () => {
    expect(formatDateTime(new Date(2026, 10, 16, 14, 5).toISOString())).toBe('16 Nov 2026, 14:05');
    expect(formatDateTime(new Date(2026, 10, 3, 0, 7).toISOString())).toBe('3 Nov 2026, 00:07');
  });
});
