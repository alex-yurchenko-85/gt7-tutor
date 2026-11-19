import { describe, expect, it } from 'vitest';
import { decode, decryptPayload, salsa20Xor, toSample } from '../src/decode.ts';
import { payloadOf, readFixture, samplesOf } from './fixtures.ts';

const kph = (mps: number) => mps * 3.6;

function hex(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  return Uint8Array.from(clean.match(/../g)!.map(pair => parseInt(pair, 16)));
}

const FORMAT_A_PACKET =
  'sYsDxsgRy8UGoGMdF7MpHQN2eRC3E7IFcN27zHkEbyCyIYZgTXQc5cNT59OvOeMDZkAuNQx6eCvzQddCGpr+v2rDEXNyagIqfQrVySnDL8R3qZRbx+IG6qQFeAEiD4bJdWhZg0LxvG0lMYbbOrkT7uY8YyAeYdmtIomG25FdX4/rJlhfZGJzxqnaJns5c11xzVUGfEsLuLSALMhn+d7fsskxfF9sUcp8/J5QtwG2iqClAjdhI+BMgpEGBOuPwvJNNG7QO5DlndkVLZcYYmXdG0g6zhCG9J0scz1B3zk8VmRT154PUbjCD36luRaqZ2lh3U6hRu4wh+oaMdCmLEtgeatLJMPhRhmAA9sGTcMmNTqbn7FU0LJODJlgnE9xKCIRzGsgpKhGtOI=';

describe('decode', () => {
  const cleanRun = readFixture('ce-clean');

  it('decodes_real_packet', () => {
    const raw = cleanRun.find(row => row.rawIndex === 8452)!;
    const sample = toSample(raw);
    expect(sample).not.toBeNull();
    expect(sample!.rawIndex).toBe(8452);
    expect(sample!.receivedMonoMs).toBe(raw.receivedMonoMs);
    expect(sample!.carId).toBe(1905);
    expect(sample!.gameTimerMs).toBe(16);
    expect(Math.abs(kph(sample!.speedMps) - 213.38)).toBeLessThan(0.5);
    for (const value of Object.values(sample!.position)) expect(Number.isFinite(value)).toBe(true);
  });

  it('decode_reads_the_game_timer', () => {
    const samples = samplesOf('b3-run');
    const timerAt = (rawIndex: number) => samples.find(sample => sample.rawIndex === rawIndex)!.gameTimerMs;
    expect(timerAt(5491)).toBe(0);
    expect(timerAt(5492)).toBe(16);
    expect(timerAt(6442)).toBe(15839);
  });

  it('decode_keeps_the_minus_one', () => {
    const sample = samplesOf('ce-off-track-reset').find(candidate => candidate.rawIndex === 7974)!;
    expect(sample.gameTimerMs).toBe(-1);
  });

  it('decode_refuses_format_a', () => {
    const packet = new Uint8Array(Buffer.from(FORMAT_A_PACKET, 'base64'));
    expect(packet.byteLength).toBe(296);
    expect(decode(packet)).toEqual({ ok: false, reason: 'unsupported-format' });
  });

  it('pedals_are_normalized', () => {
    for (const raw of cleanRun) {
      const sample = toSample(raw)!;
      expect(sample.throttle).toBeGreaterThanOrEqual(0);
      expect(sample.throttle).toBeLessThanOrEqual(1);
      expect(sample.brake).toBeGreaterThanOrEqual(0);
      expect(sample.brake).toBeLessThanOrEqual(1);
    }
  });

  it('flags_map_to_states', () => {
    const paused = readFixture('ce-pause')
      .map(raw => toSample(raw)!)
      .find(sample => sample.flags === 27);
    expect(paused).toBeDefined();
    expect(paused!.playerSession).toBe(true);
    expect(paused!.paused).toBe(true);
    expect(paused!.loading).toBe(false);
  });

  it('unsupported_length_is_reported', () => {
    expect(decode(new Uint8Array(100))).toEqual({ ok: false, reason: 'unsupported-format' });
  });

  it('corrupt_payload_is_reported', () => {
    const payload = payloadOf(cleanRun[382]!);
    payload[0] = payload[0]! ^ 0xff;
    expect(decode(payload)).toEqual({ ok: false, reason: 'decrypt' });
  });

  it('salsa20_matches_independent_vector', () => {
    const key = new Uint8Array(32);
    key[0] = 0x80;
    const nonce = new Uint8Array(8);
    const stream = salsa20Xor(key, nonce, new Uint8Array(64));
    expect(stream).toEqual(hex(`
      E3BE8FDD8BECA2E3EA8EF9475B29A6E7003951E1097A5C38D23B7A5FAD9F6844
      B22C97559E2723C7CBBD3FE4FC8D9A0744652A83E72A9C461876AF4D7EF1A117`));
  });

  it('toSample_returns_null_for_undecodable_payload', () => {
    expect(toSample({ ...cleanRun[0]!, payloadBase64: Buffer.from(new Uint8Array(100)).toString('base64') })).toBeNull();
  });

  it('toSample_returns_null_for_invalid_base64', () => {
    expect(toSample({ ...cleanRun[0]!, payloadBase64: '!!not base64!!' })).toBeNull();
  });

  describe('other formats', () => {
    it('formats_b_and_tilde_are_refused', () => {
      for (const length of [316, 344]) expect(decode(new Uint8Array(length)), String(length)).toEqual({ ok: false, reason: 'unsupported-format' });
    });
  });
});
