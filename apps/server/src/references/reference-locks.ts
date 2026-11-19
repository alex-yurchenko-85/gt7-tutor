import { Injectable } from '@nestjs/common';

@Injectable()
export class ReferenceLocks {
  private readonly holds = new Map<string, number>();
  private readonly deletions = new Map<string, Promise<void>>();

  async hold(referenceId: string): Promise<() => void> {
    for (let deletion = this.deletions.get(referenceId); deletion; deletion = this.deletions.get(referenceId)) await deletion;
    this.holds.set(referenceId, (this.holds.get(referenceId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.holds.get(referenceId)! - 1;
      if (count > 0) this.holds.set(referenceId, count);
      else this.holds.delete(referenceId);
    };
  }

  held(referenceId: string): boolean {
    return this.holds.has(referenceId);
  }

  deleting(referenceIds: string[]): (() => void) | null {
    if (referenceIds.some(id => this.holds.has(id))) return null;
    let finish: () => void = () => undefined;
    const done = new Promise<void>(resolve => (finish = resolve));
    for (const id of referenceIds) this.deletions.set(id, done);
    return () => {
      for (const id of referenceIds) if (this.deletions.get(id) === done) this.deletions.delete(id);
      finish();
    };
  }
}
