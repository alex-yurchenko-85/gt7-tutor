import { PACKET_KEY, packetNonce, salsa20Xor } from '../src/decode.ts';

const IV_OFFSET = 0x40;

export function encryptPacket(plain: Uint8Array, iv: number): Uint8Array {
  const keystream = salsa20Xor(PACKET_KEY, packetNonce(iv, plain.byteLength)!, new Uint8Array(plain.byteLength));
  const prepared = Uint8Array.from(plain);
  const ivBytes = new Uint8Array(4);
  new DataView(ivBytes.buffer).setUint32(0, iv, true);
  for (let index = 0; index < 4; index++) prepared[IV_OFFSET + index] = ivBytes[index]! ^ keystream[IV_OFFSET + index]!;
  return prepared.map((byte, index) => byte ^ keystream[index]!);
}
