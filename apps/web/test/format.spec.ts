import { describe, expect, it } from 'vitest';
import { formatDateTime, formatGap, formatTime, parseTargetTime, signedSeconds } from '../src/app/format.ts';

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

  it('format_time_shows_hours_from_one_hour', () => {
    expect(formatTime(null)).toBe('no time');
    expect(formatTime(89123)).toBe('1:29.123');
    expect(formatTime(59999)).toBe('0:59.999');
    expect(formatTime(3599999)).toBe('59:59.999');
    expect(formatTime(3600000)).toBe('1:00:00.000');
    expect(formatTime(6000725)).toBe('1:40:00.725');
    expect(formatTime(6000725, 1)).toBe('1:40:00.7');
    expect(formatTime(3599960, 1)).toBe('1:00:00.0');
  });

  it('target_time_reads_seconds_and_minutes', () => {
    expect(parseTargetTime('23.8')).toBe(23800);
    expect(parseTargetTime('0:23.800')).toBe(23800);
    expect(parseTargetTime('1:02.345')).toBe(62345);
    expect(parseTargetTime(' 0:23.8 ')).toBe(23800);
    expect(parseTargetTime('75')).toBe(75000);
    expect(parseTargetTime('1:02')).toBe(62000);
  });

  it('target_time_reads_what_a_phone_number_pad_can_type', () => {
    expect(parseTargetTime('102.5')).toBe(102500);
    expect(parseTargetTime('23,8')).toBe(23800);
    expect(parseTargetTime('1:02,345')).toBe(62345);
    expect(parseTargetTime('3600')).toBe(3_600_000);
    expect(parseTargetTime('3600.001')).toBeUndefined();
  });

  it('target_time_is_null_when_empty_and_undefined_when_not_a_time', () => {
    expect(parseTargetTime('')).toBeNull();
    expect(parseTargetTime('   ')).toBeNull();
    expect(parseTargetTime('abc')).toBeUndefined();
    expect(parseTargetTime('0')).toBeUndefined();
    expect(parseTargetTime('0:00.000')).toBeUndefined();
    expect(parseTargetTime('0:75.000')).toBeUndefined();
    expect(parseTargetTime('23.8.1')).toBeUndefined();
    expect(parseTargetTime('-23.8')).toBeUndefined();
    expect(parseTargetTime('23.8456')).toBeUndefined();
    expect(parseTargetTime('61:00.000')).toBeUndefined();
  });
});
