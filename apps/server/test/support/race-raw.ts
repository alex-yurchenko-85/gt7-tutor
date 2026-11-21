import { writeFileSync } from 'node:fs';
import type { RawDatagram, Sample } from '@gt7/contracts';
import { PACKET_KEY, packetNonce, salsa20Xor } from '@gt7/core';

const PACKET_LENGTH = 368;
const MAGIC = 0x47375330;
const SESSION_BITS = 0b111;
const IV_OFFSET = 0x40;

function encryptPacket(plain: Uint8Array, iv: number): Uint8Array {
  const keystream = salsa20Xor(PACKET_KEY, packetNonce(iv, plain.byteLength)!, new Uint8Array(plain.byteLength));
  const prepared = Uint8Array.from(plain);
  new DataView(prepared.buffer).setUint32(IV_OFFSET, iv, true);
  for (let index = 0; index < 4; index++) prepared[IV_OFFSET + index]! ^= keystream[IV_OFFSET + index]!;
  return prepared.map((byte, index) => byte ^ keystream[index]!);
}

export function racePacket(sample: Sample): Uint8Array {
  const plain = new Uint8Array(PACKET_LENGTH);
  const view = new DataView(plain.buffer);
  const vec3 = (offset: number, value: { x: number; y: number; z: number }) => {
    view.setFloat32(offset, value.x, true);
    view.setFloat32(offset + 4, value.y, true);
    view.setFloat32(offset + 8, value.z, true);
  };
  const flags = (sample.flags & ~SESSION_BITS) | (sample.playerSession ? 1 : 0) | (sample.paused ? 2 : 0) | (sample.loading ? 4 : 0);
  view.setUint32(0x00, MAGIC, true);
  vec3(0x04, sample.position);
  vec3(0x10, sample.velocity);
  view.setFloat32(0x44, sample.fuel, true);
  view.setFloat32(0x4c, sample.speedMps, true);
  view.setUint32(0x70, sample.packetId, true);
  view.setInt16(0x74, sample.lap, true);
  view.setInt16(0x76, sample.lapsInRace, true);
  view.setInt32(0x78, sample.bestLapMs, true);
  view.setInt32(0x7c, sample.lastLapMs, true);
  view.setInt16(0x84, sample.racePosition, true);
  view.setInt16(0x86, sample.carsInRace, true);
  view.setUint16(0x8e, flags, true);
  view.setUint8(0x90, sample.gear & 0x0f);
  view.setUint8(0x91, Math.round(sample.throttle * 255));
  view.setUint8(0x92, Math.round(sample.brake * 255));
  view.setInt32(0x124, sample.carId, true);
  for (let index = 0; index < 4; index++) view.setUint8(0x158 + index, sample.surface.charCodeAt(index));
  view.setInt32(0x15c, Math.round(sample.gameTimerMs), true);
  return encryptPacket(plain, sample.packetId);
}

export function raceRows(samples: Sample[]): RawDatagram[] {
  return samples.map((sample, rawIndex) => ({
    schemaVersion: 1,
    captureId: 'synthetic-race',
    rawIndex,
    receivedMonoMs: sample.receivedMonoMs,
    receivedUnixMs: 1_790_000_000_000 + Math.round(sample.receivedMonoMs),
    peerIp: '0.0.0.0',
    payloadBase64: Buffer.from(racePacket(sample)).toString('base64')
  }));
}

export function writeRaceRaw(path: string, samples: Sample[]): RawDatagram[] {
  const rows = raceRows(samples);
  writeFileSync(path, rows.map(row => `${JSON.stringify(row)}\n`).join(''));
  return rows;
}
