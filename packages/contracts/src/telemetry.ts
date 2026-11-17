import { z } from 'zod';

export const vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number()
});

export type Vec3 = z.infer<typeof vec3Schema>;

export const rawDatagramSchema = z.object({
  schemaVersion: z.literal(1),
  captureId: z.string().min(1),
  rawIndex: z.number().int().nonnegative(),
  receivedMonoMs: z.number(),
  receivedUnixMs: z.number(),
  peerIp: z.string(),
  payloadBase64: z.string()
});

export type RawDatagram = z.infer<typeof rawDatagramSchema>;

export type PacketExtension = { wheelRotationRad: number; sway: number; heave: number; surge: number };

export type Sample = {
  rawIndex: number;
  packetId: number;
  receivedMonoMs: number;
  position: Vec3;
  velocity: Vec3;
  speedMps: number;
  throttle: number;
  brake: number;
  gear: number;
  lap: number;
  carId: number;
  flags: number;
  playerSession: boolean;
  paused: boolean;
  loading: boolean;
  extension?: PacketExtension;
};
