import type { Difference, TurnLossInfo } from '@gt7/contracts';
import { describe, expect, it } from 'vitest';
import { groupByTurn } from '../src/features/review/turn-groups.ts';

function difference(sM: number, turn: number | null): Difference {
  return { kind: 'brake-early', eventKey: `brake@${sM}`, sM, size: 10, unit: 'm', turn };
}

const LOSSES: TurnLossInfo[] = [
  { turn: 1, fromSM: 0, toSM: 300, lostMs: 480 },
  { turn: 2, fromSM: 300, toSM: 700, lostMs: 620 },
  { turn: 3, fromSM: 700, toSM: 1000, lostMs: null }
];

describe('groupByTurn', () => {
  it('group_by_turn_follows_the_track_by_default', () => {
    const groups = groupByTurn([difference(900, null), difference(800, 3), difference(100, 1), difference(400, 2)], LOSSES);
    expect(groups.map(group => group.turn)).toEqual([1, 2, 3, null]);
  });

  it('group_by_turn_orders_by_time_lost', () => {
    const groups = groupByTurn([difference(100, 1), difference(400, 2), difference(800, 3), difference(900, null)], LOSSES, 'time-lost');
    expect(groups.map(group => group.turn)).toEqual([2, 1, 3, null]);
    expect(groups[0]).toMatchObject({ turn: 2, fromSM: 300, toSM: 700, lostMs: 620 });
    expect(groups[3]).toMatchObject({ turn: null, fromSM: null, toSM: null, lostMs: null });
  });

  it('group_by_turn_reverses_the_order_and_keeps_the_rest_last', () => {
    const findings = [difference(100, 1), difference(400, 2), difference(800, 3), difference(900, null)];
    expect(groupByTurn(findings, LOSSES, 'track', false, 'descending').map(group => group.turn)).toEqual([3, 2, 1, null]);
    expect(groupByTurn(findings, LOSSES, 'time-lost', false, 'ascending').map(group => group.turn)).toEqual([1, 2, 3, null]);
  });

  it('group_by_turn_keeps_finding_indices', () => {
    const findings = [difference(100, 1), difference(400, 2), difference(200, 1)];
    const groups = groupByTurn(findings, LOSSES, 'time-lost');
    expect(groups[0]!.items.map(item => item.index)).toEqual([1]);
    expect(groups[1]!.items.map(item => item.index)).toEqual([0, 2]);
    expect(groups[1]!.items[1]!.difference).toBe(findings[2]);
  });

  it('group_by_turn_skips_turns_without_differences', () => {
    expect(groupByTurn([difference(100, 1)], LOSSES).map(group => group.turn)).toEqual([1]);
  });

  it('group_by_turn_without_loss_entry_has_no_range', () => {
    expect(groupByTurn([difference(100, 4)], LOSSES)).toEqual([{ turn: 4, fromSM: null, toSM: null, lostMs: null, items: [{ difference: difference(100, 4), index: 0 }] }]);
  });
});
