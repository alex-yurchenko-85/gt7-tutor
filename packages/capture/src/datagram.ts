export type Datagram = {
  payload: Uint8Array;
  receivedMonoMs: number;
  receivedUnixMs: number;
  peerIp: string;
};

export type DatagramHandler = (datagram: Datagram) => void;

export interface TelemetrySource {
  start(on: DatagramHandler): Promise<void>;
  stop(): Promise<void>;
}
