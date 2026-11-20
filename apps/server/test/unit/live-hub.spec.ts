import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveState } from '@gt7/contracts';
import { LiveHub, STATE_TICKS_PER_SECOND, type LiveClient, type ProfileState } from '../../src/live/live-hub.service.js';

type TestClient = LiveClient & { bufferedAmount: number; states: LiveState[] };

function client(id: string): TestClient {
  const states: LiveState[] = [];
  return {
    id,
    userId: 'user',
    sessionKey: 'session',
    bufferedAmount: 0,
    states,
    send: text => {
      const message = JSON.parse(text);
      if (message.type === 'state') states.push(message.state);
    },
    close: () => undefined
  };
}

describe('LiveHub state rate', () => {
  let hub: LiveHub;

  beforeEach(() => {
    vi.useFakeTimers();
    hub = new LiveHub({ now: () => 0 }, {} as Knex);
    hub.useStateSource(() => ({ mode: 'idle' }) as unknown as ProfileState);
  });

  afterEach(() => {
    hub.onModuleDestroy();
    vi.useRealTimers();
  });

  function statesInOneSecond(clients: TestClient[]): number[] {
    const before = clients.map(item => item.states.length);
    for (let tick = 0; tick < STATE_TICKS_PER_SECOND; tick++) {
      hub.changed();
      hub.flush();
    }
    return clients.map((item, index) => item.states.length - before[index]!);
  }

  it('state_rate_follows_the_client_choice', () => {
    const plain = client('plain');
    const clients = [plain, client('15'), client('30'), client('60')];
    for (const item of clients) hub.attach(item);
    hub.receive(clients[1]!, { type: 'state-rate', perSecond: 15 });
    hub.receive(clients[2]!, { type: 'state-rate', perSecond: 30 });
    hub.receive(clients[3]!, { type: 'state-rate', perSecond: 60 });
    expect(statesInOneSecond(clients)).toEqual([15, 15, 30, 60]);
  });

  it('unchanged_state_is_not_sent_again', () => {
    const watcher = client('watcher');
    hub.attach(watcher);
    for (let tick = 0; tick < STATE_TICKS_PER_SECOND; tick++) hub.flush();
    expect(watcher.states).toHaveLength(1);
  });

  it('slow_client_is_skipped_not_queued', () => {
    const slow = client('slow');
    slow.bufferedAmount = 300 * 1024;
    hub.attach(slow);
    expect(slow.states).toHaveLength(1);
    expect(statesInOneSecond([slow])).toEqual([0]);
    slow.bufferedAmount = 0;
    hub.flush();
    expect(slow.states).toHaveLength(2);
  });
});
