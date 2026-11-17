import { decode, SequenceTracker, type DecodeFailure } from '@gt7/core';
import type { Datagram } from '@gt7/capture';

type Range = [number, number] | null;

export type TelemetrySummary = {
  datagrams: number;
  decoded: number;
  rejected: number;
  rejectReasons: Partial<Record<DecodeFailure, number>>;
  packetLengths: Record<string, number>;
  firstMonoMs: number | null;
  lastMonoMs: number | null;
  observedHz: number | null;
  gapPackets: number;
  duplicates: number;
  discontinuities: number;
  carIds: number[];
  flagValues: number[];
  speedKph: Range;
  throttle: Range;
  brake: Range;
};

function widen(range: Range, value: number): Range {
  return range === null ? [value, value] : [Math.min(range[0], value), Math.max(range[1], value)];
}

function wheelRotationText(radians: number | null): string {
  return radians === null ? '' : `, wheel rotation ${radians.toFixed(3)} rad`;
}

export class TelemetryStats {
  private readonly sequence = new SequenceTracker();
  private readonly carIds = new Set<number>();
  private readonly flagValues = new Set<number>();
  private summary: TelemetrySummary = {
    datagrams: 0,
    decoded: 0,
    rejected: 0,
    rejectReasons: {},
    packetLengths: {},
    firstMonoMs: null,
    lastMonoMs: null,
    observedHz: null,
    gapPackets: 0,
    duplicates: 0,
    discontinuities: 0,
    carIds: [],
    flagValues: [],
    speedKph: null,
    throttle: null,
    brake: null
  };
  latest: { speedKph: number; throttle: number; brake: number; lap: number; flags: number; wheelRotationRad: number | null } | null = null;

  add(datagram: Datagram): void {
    const s = this.summary;
    s.datagrams++;
    s.firstMonoMs ??= datagram.receivedMonoMs;
    s.lastMonoMs = datagram.receivedMonoMs;
    const length = String(datagram.payload.byteLength);
    s.packetLengths[length] = (s.packetLengths[length] ?? 0) + 1;
    const result = decode(datagram.payload);
    if (!result.ok) {
      s.rejected++;
      s.rejectReasons[result.reason] = (s.rejectReasons[result.reason] ?? 0) + 1;
      return;
    }
    s.decoded++;
    const sample = { ...result.sample, rawIndex: s.datagrams - 1, receivedMonoMs: datagram.receivedMonoMs };
    const step = this.sequence.accept(sample);
    s.gapPackets += step.gapPackets;
    if (step.duplicate) s.duplicates++;
    if (step.discontinuity) s.discontinuities++;
    this.carIds.add(sample.carId);
    this.flagValues.add(sample.flags);
    const speedKph = sample.speedMps * 3.6;
    s.speedKph = widen(s.speedKph, speedKph);
    s.throttle = widen(s.throttle, sample.throttle);
    s.brake = widen(s.brake, sample.brake);
    this.latest = {
      speedKph,
      throttle: sample.throttle,
      brake: sample.brake,
      lap: sample.lap,
      flags: sample.flags,
      wheelRotationRad: sample.extension?.wheelRotationRad ?? null
    };
  }

  result(): TelemetrySummary {
    const s = this.summary;
    const spanMs = s.firstMonoMs !== null && s.lastMonoMs !== null ? s.lastMonoMs - s.firstMonoMs : 0;
    return {
      ...s,
      observedHz: s.datagrams > 1 && spanMs > 0 ? ((s.datagrams - 1) * 1000) / spanMs : null,
      carIds: [...this.carIds],
      flagValues: [...this.flagValues].sort((a, b) => a - b)
    };
  }

  statusLine(): string {
    const latest = this.latest;
    if (!latest) return `Datagrams ${this.summary.datagrams}; waiting for telemetry...`;
    return `Datagrams ${this.summary.datagrams}, decoded ${this.summary.decoded}, ${latest.speedKph.toFixed(1)} km/h, throttle ${(latest.throttle * 100).toFixed(0)}%, brake ${(latest.brake * 100).toFixed(0)}%, lap ${latest.lap}, flags ${latest.flags}${wheelRotationText(latest.wheelRotationRad)}`;
  }
}
