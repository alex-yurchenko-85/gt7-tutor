import type { Sample, Vec3 } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';
import { dot, length, normalize, sub } from './geometry.ts';
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

type Candidate = { sM: number; lateralM: number; heightM: number; distanceM: number; tangent: Vec3 };

type Window = { fromM: number; toM: number; expectedM: number | null };

type Planar = { x: number; z: number };

const MIN_DISPLACEMENT_M = 0.05;
const MIN_PLANAR_VELOCITY_MPS = 0.1;

function planar(vector: Vec3): Planar | null {
  const size = Math.hypot(vector.x, vector.z);
  return size > 0 ? { x: vector.x / size, z: vector.z / size } : null;
}

function angleDeg(a: Planar, b: Planar): number {
  const cosine = Math.min(1, Math.max(-1, a.x * b.x + a.z * b.z));
  return (Math.acos(cosine) * 180) / Math.PI;
}

function rightOf(tangent: Vec3): Vec3 {
  const flat = planar(tangent);
  return flat ? { x: -flat.z, y: 0, z: flat.x } : { x: 0, y: 0, z: 0 };
}

function travelDirection(previous: Sample | null, current: Sample): Planar | null {
  if (previous) {
    const moved = sub(current.position, previous.position);
    if (Math.hypot(moved.x, moved.z) >= MIN_DISPLACEMENT_M) return planar(moved);
  }
  if (Math.hypot(current.velocity.x, current.velocity.z) >= MIN_PLANAR_VELOCITY_MPS) return planar(current.velocity);
  return null;
}

export class Matcher {
  private readonly path: ReferencePath;
  private readonly config: CoreConfig;
  private lastSM: number | null = null;
  private lastMatchMonoMs = 0;
  private lastSample: Sample | null = null;

  constructor(path: ReferencePath, config: CoreConfig) {
    this.path = path;
    this.config = config;
  }

  step(sample: Sample): Match | null {
    const previous = this.lastSample;
    this.lastSample = sample;
    const window = this.window(sample);
    const candidates = this.candidates(sample.position, window).filter(candidate => this.isNear(candidate));
    if (candidates.length === 0) return null;
    const travel = travelDirection(previous, sample);
    const moving = sample.speedMps >= this.config.match.headingMinSpeedMps;
    const scored = candidates.map(candidate => ({
      candidate,
      headingErrorDeg: travel ? angleDeg(travel, planar(candidate.tangent)!) : 0,
      cost: this.cost(candidate, window)
    }));
    const aligned = scored.filter(entry => !moving || entry.headingErrorDeg <= this.config.match.headingDeg);
    const pool = aligned.length > 0 ? aligned : scored;
    const best = pool.reduce((a, b) => (b.cost < a.cost ? b : a));
    this.lastSM = best.candidate.sM;
    this.lastMatchMonoMs = sample.receivedMonoMs;
    return {
      sM: best.candidate.sM,
      lateralM: best.candidate.lateralM,
      heightM: best.candidate.heightM,
      headingErrorDeg: best.headingErrorDeg,
      velocityErrorDeg: this.velocityError(sample, best.candidate.tangent),
      trusted: aligned.length > 0 && Math.abs(best.candidate.lateralM) <= this.config.match.lateralM,
      reference: pointAt(this.path, best.candidate.sM)
    };
  }

  reset(): void {
    this.lastSM = null;
    this.lastMatchMonoMs = 0;
    this.lastSample = null;
  }

  private window(sample: Sample): Window {
    const { searchBackM, searchForwardMinM, searchForwardMarginM } = this.config.match;
    if (this.lastSM === null) return { fromM: 0, toM: searchForwardMinM, expectedM: null };
    const travelM = (sample.speedMps * Math.max(0, sample.receivedMonoMs - this.lastMatchMonoMs)) / 1000;
    return {
      fromM: this.lastSM - searchBackM,
      toM: this.lastSM + Math.max(searchForwardMinM, travelM + searchForwardMarginM),
      expectedM: this.lastSM + travelM
    };
  }

  private candidates(position: Vec3, window: Window): Candidate[] {
    const points = this.path.points;
    const lastSegment = points.length - 2;
    const first = Math.max(0, Math.floor(window.fromM));
    const last = Math.min(lastSegment, Math.ceil(window.toM));
    const found: Candidate[] = [];
    for (let segment = first; segment <= last; segment++) {
      const candidate = this.project(position, segment);
      if (candidate) found.push(candidate);
    }
    return found;
  }

  private project(position: Vec3, segment: number): Candidate | null {
    const from = this.path.points[segment]!;
    const to = this.path.points[segment + 1]!;
    const span = sub(to.position, from.position);
    const spanM = length(span);
    const u = dot(sub(position, from.position), span) / (spanM * spanM);
    const tolerance = this.config.match.sectionEndToleranceM / spanM;
    if (u < -tolerance || u > 1 + tolerance) return null;
    const clamped = Math.min(1, Math.max(0, u));
    const foot = {
      x: from.position.x + span.x * clamped,
      y: from.position.y + span.y * clamped,
      z: from.position.z + span.z * clamped
    };
    const offset = sub(position, foot);
    const tangent = normalize(span);
    return {
      sM: from.sM + (to.sM - from.sM) * clamped,
      lateralM: dot(offset, rightOf(tangent)),
      heightM: Math.abs(offset.y),
      distanceM: length(offset),
      tangent
    };
  }

  private isNear(candidate: Candidate): boolean {
    return Math.abs(candidate.lateralM) <= this.config.match.searchLateralM && candidate.heightM <= this.config.match.heightM;
  }

  private cost(candidate: Candidate, window: Window): number {
    if (window.expectedM === null) return candidate.distanceM;
    return candidate.distanceM + this.config.match.progressWeight * Math.abs(candidate.sM - window.expectedM);
  }

  private velocityError(sample: Sample, tangent: Vec3): number | null {
    if (sample.speedMps < this.config.match.headingMinSpeedMps) return null;
    const velocity = planar(sample.velocity);
    const direction = planar(tangent);
    return velocity && direction ? angleDeg(velocity, direction) : null;
  }
}
