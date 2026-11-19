import type { Sample } from '@gt7/contracts';

export type SequenceResult = { gapPackets: number; duplicate: boolean; discontinuity: boolean };

export type SequenceLimits = { maxForwardGap: number; reorderWindow: number };

export const DEFAULT_SEQUENCE_LIMITS: SequenceLimits = { maxForwardGap: 600, reorderWindow: 64 };

const UINT32_RANGE = 0x1_0000_0000;

function forwardDistance(from: number, to: number): number {
  return (to - from + UINT32_RANGE) % UINT32_RANGE;
}

export function isRepeatedPacket(
  lastPacketId: number,
  packetId: number,
  reorderWindow: number = DEFAULT_SEQUENCE_LIMITS.reorderWindow,
): boolean {
  return forwardDistance(packetId, lastPacketId) <= reorderWindow;
}

export class SequenceTracker {
  private readonly limits: SequenceLimits;
  private lastPacketId: number | null = null;

  constructor(limits: SequenceLimits = DEFAULT_SEQUENCE_LIMITS) {
    this.limits = limits;
  }

  accept(sample: Sample): SequenceResult {
    const last = this.lastPacketId;
    if (last === null) return this.advance(sample.packetId, 0, false);
    if (isRepeatedPacket(last, sample.packetId, this.limits.reorderWindow)) {
      return { gapPackets: 0, duplicate: true, discontinuity: false };
    }
    const forward = forwardDistance(last, sample.packetId);
    if (forward > this.limits.maxForwardGap) return this.advance(sample.packetId, 0, true);
    return this.advance(sample.packetId, forward - 1, false);
  }

  reset(): void {
    this.lastPacketId = null;
  }

  private advance(packetId: number, gapPackets: number, discontinuity: boolean): SequenceResult {
    this.lastPacketId = packetId;
    return { gapPackets, duplicate: false, discontinuity };
  }
}
