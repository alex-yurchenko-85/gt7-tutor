import { describe, expect, it } from 'vitest';
import { decode, decryptPayload, salsa20Xor, toSample } from '../src/decode.ts';
import { encryptPacket } from './packets.ts';
import { payloadOf, readFixture } from './fixtures.ts';

const kph = (mps: number) => mps * 3.6;

function hex(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  return Uint8Array.from(clean.match(/../g)!.map(pair => parseInt(pair, 16)));
}

describe('decode', () => {
  const playerRun = readFixture('player-run');

  it('decodes_real_packet', () => {
    const raw = playerRun.find(row => row.rawIndex === 1162)!;
    const sample = toSample(raw);
    expect(sample).not.toBeNull();
    expect(sample!.rawIndex).toBe(1162);
    expect(sample!.receivedMonoMs).toBe(raw.receivedMonoMs);
    expect(sample!.carId).toBe(3602);
    expect(Math.abs(kph(sample!.speedMps) - 207.14)).toBeLessThan(0.5);
    for (const value of Object.values(sample!.position)) expect(Number.isFinite(value)).toBe(true);
  });

  it('pedals_are_normalized', () => {
    for (const raw of playerRun) {
      const sample = toSample(raw)!;
      expect(sample.throttle).toBeGreaterThanOrEqual(0);
      expect(sample.throttle).toBeLessThanOrEqual(1);
      expect(sample.brake).toBeGreaterThanOrEqual(0);
      expect(sample.brake).toBeLessThanOrEqual(1);
    }
  });

  it('flags_map_to_states', () => {
    const paused = readFixture('player-pause')
      .map(raw => toSample(raw)!)
      .find(sample => sample.flags === 1035);
    expect(paused).toBeDefined();
    expect(paused!.playerSession).toBe(true);
    expect(paused!.paused).toBe(true);
    expect(paused!.loading).toBe(false);
  });

  it('unsupported_length_is_reported', () => {
    expect(decode(new Uint8Array(100))).toEqual({ ok: false, reason: 'unsupported-format' });
  });

  it('corrupt_payload_is_reported', () => {
    const payload = payloadOf(playerRun[1162]!);
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
    expect(toSample({ ...playerRun[0]!, payloadBase64: Buffer.from(new Uint8Array(100)).toString('base64') })).toBeNull();
  });

  it('toSample_returns_null_for_invalid_base64', () => {
    expect(toSample({ ...playerRun[0]!, payloadBase64: '!!not base64!!' })).toBeNull();
  });

  describe('extended formats', () => {
    const basePlain = () => decryptPayload(payloadOf(playerRun[1162]!))!;

    function extended(length: number, floats: number[]): Uint8Array {
      const plain = new Uint8Array(length);
      plain.set(basePlain());
      const view = new DataView(plain.buffer);
      floats.forEach((value, index) => view.setFloat32(0x128 + index * 4, value, true));
      return encryptPacket(plain, 0x1234abcd);
    }

    it('format_b_decodes_base_fields_and_extension', () => {
      const result = decode(extended(316, [0.25, 0, 0.1, -0.2, 0.3]));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const base = toSample(playerRun[1162]!)!;
      expect(result.sample.carId).toBe(3602);
      expect(result.sample.speedMps).toBe(base.speedMps);
      expect(result.sample.position).toEqual(base.position);
      expect(result.sample.extension!.wheelRotationRad).toBeCloseTo(0.25, 6);
      expect(result.sample.extension!.sway).toBeCloseTo(0.1, 6);
      expect(result.sample.extension!.heave).toBeCloseTo(-0.2, 6);
      expect(result.sample.extension!.surge).toBeCloseTo(0.3, 6);
    });

    it('format_a_has_no_extension', () => {
      expect('extension' in toSample(playerRun[1162]!)!).toBe(false);
    });

    it('formats_tilde_and_c_decode_the_b_extension', () => {
      for (const length of [344, 368]) {
        const result = decode(extended(length, [-0.5, 0, 0, 0, 0]));
        expect(result.ok, String(length)).toBe(true);
        if (result.ok) expect(result.sample.extension!.wheelRotationRad).toBeCloseTo(-0.5, 6);
      }
    });

    it('packet_encrypted_with_another_format_key_fails', () => {
      const packet = extended(316, [0, 0, 0, 0, 0]);
      const asBase = new Uint8Array(296);
      asBase.set(packet.subarray(0, 296));
      expect(decode(asBase)).toEqual({ ok: false, reason: 'decrypt' });
    });
  });
});

