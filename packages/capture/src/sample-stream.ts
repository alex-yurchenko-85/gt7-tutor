import type { Sample } from '@gt7/contracts';
import { decode, PacketClock, SequenceTracker } from '@gt7/core';

export type SampleRow = { rawIndex: number; receivedMonoMs: number; payload: Uint8Array };

export type SampleStreamOptions = { warmupFrom: number };

export class SampleStream {
  private readonly warmupFrom: number;
  private readonly sequence = new SequenceTracker();
  private readonly clock = new PacketClock();

  constructor(options: SampleStreamOptions) {
    this.warmupFrom = options.warmupFrom;
  }

  push(row: SampleRow): Sample | null {
    const decoded = decode(row.payload);
    if (!decoded.ok) return null;
    const sample: Sample = { ...decoded.sample, rawIndex: row.rawIndex, receivedMonoMs: row.receivedMonoMs };
    if (this.sequence.accept(sample).duplicate) return null;
    const clockMs = this.clock.next(sample.packetId, sample.receivedMonoMs);
    return row.rawIndex < this.warmupFrom ? null : { ...sample, clockMs };
  }
}
