const INITIAL_CAPACITY = 32;

export class SpeedWindow {
  private readonly windowMs: number;
  private atMs = new Float64Array(INITIAL_CAPACITY);
  private speedMps = new Float64Array(INITIAL_CAPACITY);
  private head = 0;
  private count = 0;
  private ordered = true;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  get oldestAtMs(): number {
    return this.atMs[this.head]!;
  }

  get oldestSpeedMps(): number {
    return this.speedMps[this.head]!;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.ordered = true;
  }

  add(atMs: number, speedMps: number): void {
    if (this.ordered) this.dropOld(atMs);
    else this.keepRecent(atMs);
    if (this.count > 0 && !(atMs >= this.atMs[this.slot(this.count - 1)]!)) this.ordered = false;
    if (this.count === this.atMs.length) this.grow();
    const slot = this.slot(this.count);
    this.atMs[slot] = atMs;
    this.speedMps[slot] = speedMps;
    this.count += 1;
  }

  private slot(offset: number): number {
    return (this.head + offset) % this.atMs.length;
  }

  private dropOld(nowMs: number): void {
    while (this.count > 0 && !(nowMs - this.atMs[this.head]! <= this.windowMs)) {
      this.head = (this.head + 1) % this.atMs.length;
      this.count -= 1;
    }
  }

  private keepRecent(nowMs: number): void {
    let kept = 0;
    let ordered = true;
    for (let offset = 0; offset < this.count; offset++) {
      const from = this.slot(offset);
      if (!(nowMs - this.atMs[from]! <= this.windowMs)) continue;
      const to = this.slot(kept);
      if (kept > 0 && !(this.atMs[from]! >= this.atMs[this.slot(kept - 1)]!)) ordered = false;
      this.atMs[to] = this.atMs[from]!;
      this.speedMps[to] = this.speedMps[from]!;
      kept += 1;
    }
    this.count = kept;
    this.ordered = ordered;
  }

  private grow(): void {
    const atMs = new Float64Array(this.atMs.length * 2);
    const speedMps = new Float64Array(this.speedMps.length * 2);
    for (let offset = 0; offset < this.count; offset++) {
      atMs[offset] = this.atMs[this.slot(offset)]!;
      speedMps[offset] = this.speedMps[this.slot(offset)]!;
    }
    this.atMs = atMs;
    this.speedMps = speedMps;
    this.head = 0;
  }
}
