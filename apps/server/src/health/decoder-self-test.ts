import { decode } from '@gt7/core';

const YANGWANG_PACKET_BASE64 =
  'sYsDxsgRy8UGoGMdF7MpHQN2eRC3E7IFcN27zHkEbyCyIYZgTXQc5cNT59OvOeMDZkAuNQx6eCvzQddCGpr+v2rDEXNyagIqfQrVySnDL8R3qZRbx+IG6qQFeAEiD4bJdWhZg0LxvG0lMYbbOrkT7uY8YyAeYdmtIomG25FdX4/rJlhfZGJzxqnaJns5c11xzVUGfEsLuLSALMhn+d7fsskxfF9sUcp8/J5QtwG2iqClAjdhI+BMgpEGBOuPwvJNNG7QO5DlndkVLZcYYmXdG0g6zhCG9J0scz1B3zk8VmRT154PUbjCD36luRaqZ2lh3U6hRu4wh+oaMdCmLEtgeatLJMPhRhmAA9sGTcMmNTqbn7FU0LJODJlgnE9xKCIRzGsgpKhGtOI=';
const YANGWANG_CAR_ID = 3602;

export function decoderWorks(): boolean {
  const result = decode(new Uint8Array(Buffer.from(YANGWANG_PACKET_BASE64, 'base64')));
  return result.ok && result.sample.carId === YANGWANG_CAR_ID;
}
