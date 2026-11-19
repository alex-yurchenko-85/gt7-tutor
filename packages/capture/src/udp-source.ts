import { createSocket, type Socket } from 'node:dgram';
import { DEFAULT_CONFIG } from '@gt7/core';
import type { DatagramHandler, TelemetrySource } from './datagram.ts';

export type UdpSourceOptions = {
  ps5Ip: string;
  bindPort?: number;
  bindAddress?: string;
  heartbeatPort?: number;
  heartbeatMs?: number;
  now?: () => number;
};

export class UdpSource implements TelemetrySource {
  foreignDatagrams = 0;
  heartbeatErrors = 0;
  lastError: string | null = null;
  private readonly ps5Ip: string;
  private readonly bindPort: number;
  private readonly bindAddress: string;
  private readonly heartbeatPort: number;
  private readonly heartbeatMs: number;
  private readonly heartbeatMessage: Buffer;
  private readonly now: () => number;
  private socket: Socket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(options: UdpSourceOptions) {
    this.ps5Ip = options.ps5Ip;
    this.bindPort = options.bindPort ?? DEFAULT_CONFIG.udp.receivePort;
    this.bindAddress = options.bindAddress ?? '0.0.0.0';
    this.heartbeatPort = options.heartbeatPort ?? DEFAULT_CONFIG.udp.heartbeatPort;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_CONFIG.udp.heartbeatMs;
    this.heartbeatMessage = Buffer.from('C');
    this.now = options.now ?? (() => performance.now());
  }

  boundPort(): number | null {
    return this.socket ? this.socket.address().port : null;
  }

  start(on: DatagramHandler): Promise<void> {
    const socket = createSocket('udp4');
    this.socket = socket;
    socket.on('message', (message, peer) => {
      if (peer.address !== this.ps5Ip) {
        this.foreignDatagrams++;
        return;
      }
      on({ payload: new Uint8Array(message), receivedMonoMs: this.now(), receivedUnixMs: Date.now(), peerIp: peer.address });
    });
    return new Promise((resolve, reject) => {
      const onBindError = (error: NodeJS.ErrnoException) => {
        this.socket = null;
        socket.close();
        reject(new Error(`Cannot receive telemetry on UDP port ${this.bindPort}: ${error.code ?? error.message}. Stop any other receiver on this port.`));
      };
      socket.once('error', onBindError);
      socket.bind(this.bindPort, this.bindAddress, () => {
        socket.off('error', onBindError);
        socket.on('error', error => {
          this.lastError = error.message;
        });
        this.sendHeartbeat();
        this.heartbeat = setInterval(() => this.sendHeartbeat(), this.heartbeatMs);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return Promise.resolve();
    return new Promise(resolve => socket.close(() => resolve()));
  }

  private sendHeartbeat() {
    this.socket?.send(this.heartbeatMessage, this.heartbeatPort, this.ps5Ip, error => {
      if (error) this.heartbeatErrors++;
    });
  }
}
