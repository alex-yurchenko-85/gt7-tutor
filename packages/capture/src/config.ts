export type CaptureConfig = {
  udp: { receivePort: number; heartbeatPort: number; heartbeatMs: number };
  rawQueueBytes: number;
};

export const CAPTURE_CONFIG: CaptureConfig = {
  udp: { receivePort: 33740, heartbeatPort: 33739, heartbeatMs: 1000 },
  rawQueueBytes: 8 * 1024 * 1024
};
