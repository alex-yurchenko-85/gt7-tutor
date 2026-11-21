import type { Sample } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';
import { pointAt, type ReferencePath, type ReferencePoint } from './reference.ts';

export type Match = {
  sM: number;
  lateralM: number;
  heightM: number;
  headingErrorDeg: number;
  velocityErrorDeg: number | null;
  trusted: boolean;
  reference: ReferencePoint;
};

const MIN_DISPLACEMENT_M = 0.05;
const MIN_PLANAR_VELOCITY_MPS = 0.1;

const FROM_X = 0;
const FROM_Y = 1;
const FROM_Z = 2;
const SPAN_X = 3;
const SPAN_Y = 4;
const SPAN_Z = 5;
const INVERSE_SQUARED_M = 6;
const END_TOLERANCE = 7;
const TANGENT_X = 8;
const TANGENT_Z = 9;
const RIGHT_X = 10;
const RIGHT_Z = 11;
const FROM_S = 12;
const SPAN_S = 13;
const STRIDE = 14;

function angleDeg(ax: number, az: number, bx: number, bz: number): number {
  const cosine = Math.min(1, Math.max(-1, ax * bx + az * bz));
  return (Math.acos(cosine) * 180) / Math.PI;
}

function segmentsOf(path: ReferencePath, config: CoreConfig): Float64Array {
  const count = path.points.length - 1;
  const segments = new Float64Array(Math.max(0, count) * STRIDE);
  for (let segment = 0; segment < count; segment++) {
    const from = path.points[segment]!;
    const to = path.points[segment + 1]!;
    const spanX = to.position.x - from.position.x;
    const spanY = to.position.y - from.position.y;
    const spanZ = to.position.z - from.position.z;
    const spanM = Math.hypot(spanX, spanY, spanZ);
    const inverseM = 1 / spanM;
    const tangentX = spanX * inverseM;
    const tangentZ = spanZ * inverseM;
    const flatM = Math.hypot(tangentX, tangentZ);
    const offset = segment * STRIDE;
    segments[offset + FROM_X] = from.position.x;
    segments[offset + FROM_Y] = from.position.y;
    segments[offset + FROM_Z] = from.position.z;
    segments[offset + SPAN_X] = spanX;
    segments[offset + SPAN_Y] = spanY;
    segments[offset + SPAN_Z] = spanZ;
    segments[offset + INVERSE_SQUARED_M] = 1 / (spanM * spanM);
    segments[offset + END_TOLERANCE] = config.match.sectionEndToleranceM / spanM;
    segments[offset + TANGENT_X] = tangentX / flatM;
    segments[offset + TANGENT_Z] = tangentZ / flatM;
    segments[offset + RIGHT_X] = -(tangentZ / flatM);
    segments[offset + RIGHT_Z] = tangentX / flatM;
    segments[offset + FROM_S] = from.sM;
    segments[offset + SPAN_S] = to.sM - from.sM;
  }
  return segments;
}

class Best {
  found = false;
  segment = 0;
  cost = 0;
  sM = 0;
  lateralM = 0;
  heightM = 0;
  headingErrorDeg = 0;

  clear(): void {
    this.found = false;
  }

  offer(segment: number, cost: number, sM: number, lateralM: number, heightM: number, headingErrorDeg: number): void {
    if (this.found && !(cost < this.cost)) return;
    this.found = true;
    this.segment = segment;
    this.cost = cost;
    this.sM = sM;
    this.lateralM = lateralM;
    this.heightM = heightM;
    this.headingErrorDeg = headingErrorDeg;
  }
}

export class Matcher {
  private readonly path: ReferencePath;
  private readonly config: CoreConfig;
  private readonly segments: Float64Array;
  private readonly lastSegment: number;
  private readonly aligned = new Best();
  private readonly nearest = new Best();
  private lastSM: number | null = null;
  private lastMatchMonoMs = 0;
  private lastSample: Sample | null = null;
  private readonly startSM: number | null;

  constructor(path: ReferencePath, config: CoreConfig, startSM?: number) {
    this.path = path;
    this.config = config;
    this.startSM = startSM ?? null;
    this.segments = segmentsOf(path, config);
    this.lastSegment = path.points.length - 2;
  }

  step(sample: Sample): Match | null {
    const previous = this.lastSample;
    this.lastSample = sample;
    const { searchBackM, searchForwardMinM, searchForwardMarginM, searchLateralM, heightM, headingDeg, headingMinSpeedMps, progressWeight } =
      this.config.match;
    let fromM = this.startSM === null ? 0 : this.startSM - searchBackM;
    let toM = (this.startSM ?? 0) + searchForwardMinM;
    let expectedM: number | null = null;
    if (this.lastSM !== null) {
      const travelM = (sample.speedMps * Math.max(0, sample.receivedMonoMs - this.lastMatchMonoMs)) / 1000;
      fromM = this.lastSM - searchBackM;
      toM = this.lastSM + Math.max(searchForwardMinM, travelM + searchForwardMarginM);
      expectedM = this.lastSM + travelM;
    }
    let travelX = 0;
    let travelZ = 0;
    let travels = false;
    if (previous) {
      const movedX = sample.position.x - previous.position.x;
      const movedZ = sample.position.z - previous.position.z;
      const movedM = Math.hypot(movedX, movedZ);
      if (movedM >= MIN_DISPLACEMENT_M) {
        travelX = movedX / movedM;
        travelZ = movedZ / movedM;
        travels = true;
      }
    }
    if (!travels) {
      const planarMps = Math.hypot(sample.velocity.x, sample.velocity.z);
      if (planarMps >= MIN_PLANAR_VELOCITY_MPS) {
        travelX = sample.velocity.x / planarMps;
        travelZ = sample.velocity.z / planarMps;
        travels = true;
      }
    }
    const moving = sample.speedMps >= headingMinSpeedMps;
    const { x, y, z } = sample.position;
    const segments = this.segments;
    this.aligned.clear();
    this.nearest.clear();
    const last = Math.min(this.lastSegment, Math.ceil(toM));
    for (let segment = Math.max(0, Math.floor(fromM)); segment <= last; segment++) {
      const offset = segment * STRIDE;
      const fromX = segments[offset + FROM_X]!;
      const fromY = segments[offset + FROM_Y]!;
      const fromZ = segments[offset + FROM_Z]!;
      const spanX = segments[offset + SPAN_X]!;
      const spanY = segments[offset + SPAN_Y]!;
      const spanZ = segments[offset + SPAN_Z]!;
      const u = ((x - fromX) * spanX + (y - fromY) * spanY + (z - fromZ) * spanZ) * segments[offset + INVERSE_SQUARED_M]!;
      const tolerance = segments[offset + END_TOLERANCE]!;
      if (u < -tolerance || u > 1 + tolerance) continue;
      const clamped = Math.min(1, Math.max(0, u));
      const offsetX = x - (fromX + spanX * clamped);
      const offsetY = y - (fromY + spanY * clamped);
      const offsetZ = z - (fromZ + spanZ * clamped);
      const lateralM = offsetX * segments[offset + RIGHT_X]! + offsetZ * segments[offset + RIGHT_Z]!;
      const height = Math.abs(offsetY);
      if (!(Math.abs(lateralM) <= searchLateralM && height <= heightM)) continue;
      const sM = segments[offset + FROM_S]! + segments[offset + SPAN_S]! * clamped;
      const distanceM = Math.hypot(offsetX, offsetY, offsetZ);
      const cost = expectedM === null ? distanceM : distanceM + progressWeight * Math.abs(sM - expectedM);
      const headingErrorDeg = travels ? angleDeg(travelX, travelZ, segments[offset + TANGENT_X]!, segments[offset + TANGENT_Z]!) : 0;
      this.nearest.offer(segment, cost, sM, lateralM, height, headingErrorDeg);
      if (!moving || headingErrorDeg <= headingDeg) this.aligned.offer(segment, cost, sM, lateralM, height, headingErrorDeg);
    }
    if (!this.nearest.found) return null;
    const best = this.aligned.found ? this.aligned : this.nearest;
    this.lastSM = best.sM;
    this.lastMatchMonoMs = sample.receivedMonoMs;
    return {
      sM: best.sM,
      lateralM: best.lateralM,
      heightM: best.heightM,
      headingErrorDeg: best.headingErrorDeg,
      velocityErrorDeg: this.velocityError(sample, best.segment),
      trusted: this.aligned.found && Math.abs(best.lateralM) <= this.config.match.lateralM,
      reference: pointAt(this.path, best.sM)
    };
  }

  reset(): void {
    this.lastSM = null;
    this.lastMatchMonoMs = 0;
    this.lastSample = null;
  }

  private velocityError(sample: Sample, segment: number): number | null {
    if (sample.speedMps < this.config.match.headingMinSpeedMps) return null;
    const { x, z } = sample.velocity;
    const planarMps = Math.hypot(x, z);
    if (!(planarMps > 0)) return null;
    const offset = segment * STRIDE;
    return angleDeg(x / planarMps, z / planarMps, this.segments[offset + TANGENT_X]!, this.segments[offset + TANGENT_Z]!);
  }
}
