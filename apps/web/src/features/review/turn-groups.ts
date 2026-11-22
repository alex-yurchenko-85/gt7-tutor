import type { Difference, TurnLossInfo } from '@gt7/contracts';
import type { SortDirection } from '../../app/SortHeader.tsx';

export type TurnGroup = {
  turn: number | null;
  fromSM: number | null;
  toSM: number | null;
  lostMs: number | null;
  items: { difference: Difference; index: number }[];
};

function emptyGroup(turn: number | null, losses: TurnLossInfo[]): TurnGroup {
  const loss = turn === null ? undefined : losses.find(entry => entry.turn === turn);
  return { turn, fromSM: loss?.fromSM ?? null, toSM: loss?.toSM ?? null, lostMs: loss?.lostMs ?? null, items: [] };
}

export type TurnOrder = 'track' | 'time-lost';

export const TURN_ORDER_DIRECTIONS: Record<TurnOrder, SortDirection> = { track: 'ascending', 'time-lost': 'descending' };

function byTrack(sign: number) {
  return (a: TurnGroup, b: TurnGroup): number => {
    if (a.turn === null || b.turn === null) return a.turn === null ? (b.turn === null ? 0 : 1) : -1;
    return sign * (a.turn - b.turn);
  };
}

function byTimeLost(sign: number) {
  return (a: TurnGroup, b: TurnGroup): number => {
    if (a.turn === null || b.turn === null) return a.turn === null ? (b.turn === null ? 0 : 1) : -1;
    if (a.lostMs === null || b.lostMs === null) return a.lostMs === null ? (b.lostMs === null ? a.turn - b.turn : 1) : -1;
    return sign * (a.lostMs - b.lostMs) || a.turn - b.turn;
  };
}

export function groupByTurn(findings: Difference[], losses: TurnLossInfo[], order: TurnOrder = 'track', allTurns = false, direction: SortDirection = TURN_ORDER_DIRECTIONS[order]): TurnGroup[] {
  const groups = new Map<number | null, TurnGroup>();
  if (allTurns) for (const loss of losses) groups.set(loss.turn, emptyGroup(loss.turn, losses));
  findings.forEach((difference, index) => {
    const group = groups.get(difference.turn) ?? emptyGroup(difference.turn, losses);
    group.items.push({ difference, index });
    groups.set(difference.turn, group);
  });
  const sign = direction === 'ascending' ? 1 : -1;
  return [...groups.values()].sort(order === 'track' ? byTrack(sign) : byTimeLost(sign));
}
