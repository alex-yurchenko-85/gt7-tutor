import type { Difference, TurnLossInfo } from '@gt7/contracts';

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

function byTrack(a: TurnGroup, b: TurnGroup): number {
  if (a.turn === null || b.turn === null) return a.turn === null ? (b.turn === null ? 0 : 1) : -1;
  return a.turn - b.turn;
}

function byTimeLost(a: TurnGroup, b: TurnGroup): number {
  if (a.turn === null || b.turn === null) return a.turn === null ? (b.turn === null ? 0 : 1) : -1;
  if (a.lostMs === null || b.lostMs === null) return a.lostMs === null ? (b.lostMs === null ? a.turn - b.turn : 1) : -1;
  return b.lostMs - a.lostMs || a.turn - b.turn;
}

export function groupByTurn(findings: Difference[], losses: TurnLossInfo[], order: TurnOrder = 'track'): TurnGroup[] {
  const groups = new Map<number | null, TurnGroup>();
  findings.forEach((difference, index) => {
    const group = groups.get(difference.turn) ?? emptyGroup(difference.turn, losses);
    group.items.push({ difference, index });
    groups.set(difference.turn, group);
  });
  return [...groups.values()].sort(order === 'track' ? byTrack : byTimeLost);
}
