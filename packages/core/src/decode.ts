import { salsa20 } from '@noble/ciphers/salsa.js';
import type { RawDatagram, Sample, Vec3 } from '@gt7/contracts';

export type DecodedSample = Omit<Sample, 'rawIndex' | 'receivedMonoMs'>;

export type DecodeFailure = 'unsupported-format' | 'decrypt' | 'invalid-fields';

export type DecodeResult = { ok: true; sample: DecodedSample } | { ok: false; reason: DecodeFailure };

const PACKET_LENGTH = 368;
const NONCE_XOR = 0xdeadbeef;
const MAGIC = 0x47375330;
export const PACKET_KEY = asciiBytes('Simulator Interface Packet GT7 ver 0.0').subarray(0, 32);

const Offset = {
  iv: 0x40,
  magic: 0x00,
  position: 0x04,
  velocity: 0x10,
  speed: 0x4c,
  packetId: 0x70,
  lap: 0x74,
  flags: 0x8e,
  gear: 0x90,
  throttle: 0x91,
  brake: 0x92,
  carId: 0x124,
  gameTimer: 0x15c
} as const;

const Flag = {
  playerSession: 1 << 0,
  paused: 1 << 1,
  loading: 1 << 2
} as const;

function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, character => character.charCodeAt(0));
}

export function salsa20Xor(key: Uint8Array, nonce: Uint8Array, data: Uint8Array): Uint8Array {
  return salsa20(key, nonce, data);
}

export function packetNonce(iv: number, length: number): Uint8Array | null {
  if (length !== PACKET_LENGTH) return null;
  const nonce = new Uint8Array(8);
  const view = new DataView(nonce.buffer);
  view.setUint32(0, (iv ^ NONCE_XOR) >>> 0, true);
  view.setUint32(4, iv, true);
  return nonce;
}

function readVec3(view: DataView, offset: number): Vec3 {
  return {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true),
    z: view.getFloat32(offset + 8, true)
  };
}

function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function readFields(plain: Uint8Array): DecodedSample {
  const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const flags = view.getUint16(Offset.flags, true);
  return {
    packetId: view.getUint32(Offset.packetId, true),
    position: readVec3(view, Offset.position),
    velocity: readVec3(view, Offset.velocity),
    speedMps: view.getFloat32(Offset.speed, true),
    throttle: view.getUint8(Offset.throttle) / 255,
    brake: view.getUint8(Offset.brake) / 255,
    gear: view.getUint8(Offset.gear) & 0x0f,
    lap: view.getInt16(Offset.lap, true),
    carId: view.getInt32(Offset.carId, true),
    flags,
    playerSession: (flags & Flag.playerSession) !== 0,
    paused: (flags & Flag.paused) !== 0,
    loading: (flags & Flag.loading) !== 0,
    gameTimerMs: view.getInt32(Offset.gameTimer, true)
  };
}

export function decryptPayload(payload: Uint8Array): Uint8Array | null {
  const iv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(Offset.iv, true);
  const nonce = packetNonce(iv, payload.byteLength);
  if (nonce === null) return null;
  const plain = salsa20Xor(PACKET_KEY, nonce, payload);
  const magic = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(Offset.magic, true);
  return magic === MAGIC ? plain : null;
}

export function decode(payload: Uint8Array): DecodeResult {
  if (payload.byteLength !== PACKET_LENGTH) return { ok: false, reason: 'unsupported-format' };
  const plain = decryptPayload(payload);
  if (plain === null) return { ok: false, reason: 'decrypt' };
  const sample = readFields(plain);
  const valid = isFiniteVec3(sample.position) && isFiniteVec3(sample.velocity) && Number.isFinite(sample.speedMps);
  if (!valid) return { ok: false, reason: 'invalid-fields' };
  return { ok: true, sample };
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUE = new Map([...BASE64_ALPHABET].map((character, value) => [character, value]));

function base64ToBytes(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const character of clean) {
    const value = BASE64_VALUE.get(character);
    if (value === undefined) return null;
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

export function toSample(raw: RawDatagram): Sample | null {
  const payload = base64ToBytes(raw.payloadBase64);
  if (payload === null) return null;
  const result = decode(payload);
  if (!result.ok) return null;
  return { ...result.sample, rawIndex: raw.rawIndex, receivedMonoMs: raw.receivedMonoMs };
}
