import { Injectable } from '@nestjs/common';

export const SIGN_IN_FAILURE_LIMIT = 5;
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class SignInLimiter {
  private readonly failures = new Map<string, number[]>();

  isBlocked(name: string, address: string, nowMs = Date.now()): boolean {
    return this.recent(this.key(name, address), nowMs).length >= SIGN_IN_FAILURE_LIMIT;
  }

  recordFailure(name: string, address: string, nowMs = Date.now()): void {
    const key = this.key(name, address);
    this.failures.set(key, [...this.recent(key, nowMs), nowMs]);
  }

  clear(name: string, address: string): void {
    this.failures.delete(this.key(name, address));
  }

  private recent(key: string, nowMs: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter(at => nowMs - at < SIGN_IN_WINDOW_MS);
    if (kept.length === 0) this.failures.delete(key);
    else this.failures.set(key, kept);
    return kept;
  }

  private key(name: string, address: string): string {
    return `${name}\u0000${address}`;
  }
}
