import type { LiveCue } from '@gt7/contracts';

export class SeenCues {
  private generation = 0;
  private readonly seen = new Map<string, number>();

  firstSeenMs(cue: LiveCue, nowMs: number): number {
    if (cue.generation !== this.generation) {
      this.generation = cue.generation;
      this.seen.clear();
    }
    let first = this.seen.get(cue.id);
    if (first === undefined) {
      first = nowMs;
      this.seen.set(cue.id, first);
    }
    return first;
  }
}
