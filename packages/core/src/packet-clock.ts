import type { Sample } from '@gt7/contracts';

export const NOMINAL_PACKET_MS = 1000 / 60;
export const ENVELOPE_RISE = 0.02;
export const PACKET_STEP_MAX = 600;
export const CLOCK_WARMUP_PACKETS = 600;

const ID_RANGE = 2 ** 32;
const BEHIND_MAX = 64;

export class PacketClock {
  private lastId: number | null = null;
  private lastArrivalMs = 0;
  private clockMs = 0;
  private runPackets = 0;
  private runStartArrivalMs = 0;
  private envelopeMs = 0;

  next(packetId: number, receivedMonoMs: number): number {
    if (this.lastId === null) {
      this.clockMs = receivedMonoMs;
      this.startRun(packetId, receivedMonoMs);
      return this.clockMs;
    }
    const step = (packetId - this.lastId + ID_RANGE) % ID_RANGE;
    if (step === 0 || step > ID_RANGE - BEHIND_MAX) return this.clockMs;
    if (step > PACKET_STEP_MAX) {
      this.clockMs += Math.max(0, receivedMonoMs - this.lastArrivalMs);
      this.startRun(packetId, receivedMonoMs);
      return this.clockMs;
    }
    this.runPackets += step;
    const offsetMs = receivedMonoMs - this.runStartArrivalMs - this.runPackets * NOMINAL_PACKET_MS;
    const previousEnvelopeMs = this.envelopeMs;
    this.envelopeMs = offsetMs < this.envelopeMs ? offsetMs : this.envelopeMs + ENVELOPE_RISE * (offsetMs - this.envelopeMs);
    this.clockMs += Math.max(0, step * NOMINAL_PACKET_MS + (this.envelopeMs - previousEnvelopeMs));
    this.lastId = packetId;
    this.lastArrivalMs = receivedMonoMs;
    return this.clockMs;
  }

  private startRun(packetId: number, receivedMonoMs: number): void {
    this.lastId = packetId;
    this.lastArrivalMs = receivedMonoMs;
    this.runPackets = 0;
    this.runStartArrivalMs = receivedMonoMs;
    this.envelopeMs = 0;
  }
}

export function clockWarmupStart(first: number): number {
  return Math.max(0, first - CLOCK_WARMUP_PACKETS);
}

export function withPacketClock(samples: Sample[]): Sample[] {
  const clock = new PacketClock();
  return samples.map(sample => ({ ...sample, clockMs: clock.next(sample.packetId, sample.receivedMonoMs) }));
}

export function clockOf(sample: Sample): number {
  return sample.clockMs ?? sample.receivedMonoMs;
}
