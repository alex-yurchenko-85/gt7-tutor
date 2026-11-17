import type { FocusSummary } from '@gt7/contracts';
import { DEFAULT_CONFIG, focusSentence, recurring, type Corner, type Finding, type Focus } from '@gt7/core';
import type { Knex } from 'knex';

export const FOCUS_ATTEMPTS = 8;

type FindingRow = { attempt_id: string; kind: Finding['kind']; event_key: string | null; s_m: number; size: number; unit: Finding['unit'] };

export type FocusScope = { exerciseId: string; referenceId: string; upTo: { startedAt: Date; id: string } | null };

export function toFinding(row: Omit<FindingRow, 'attempt_id'>): Finding {
  return { kind: row.kind, eventKey: row.event_key, sM: row.s_m, size: row.size, unit: row.unit };
}

export async function recentFindings(db: Knex, scope: FocusScope, limit: number): Promise<Finding[][]> {
  if (limit <= 0) return [];
  const query = db('attempts')
    .where({ exercise_id: scope.exerciseId, reference_id: scope.referenceId, completion: 'complete' })
    .orderBy([{ column: 'started_at', order: 'desc' }, { column: 'id', order: 'desc' }])
    .limit(limit)
    .select<{ id: string }[]>('id');
  if (scope.upTo) {
    const { startedAt, id } = scope.upTo;
    query.where(builder => builder.where('started_at', '<', startedAt).orWhere(inner => inner.where('started_at', startedAt).andWhere('id', '<=', id)));
  }
  const attempts = await query;
  const rows = await db('attempt_findings')
    .whereIn('attempt_id', attempts.map(attempt => attempt.id))
    .andWhere({ reference_id: scope.referenceId })
    .select<FindingRow[]>('attempt_id', 'kind', 'event_key', 's_m', 'size', 'unit');
  return attempts.map(attempt => rows.filter(row => row.attempt_id === attempt.id).map(toFinding));
}

export function focusOf(latestFirst: Finding[][], corners: Corner[]): Focus | null {
  const [latest = []] = latestFirst;
  return focusSentence(recurring(latestFirst, DEFAULT_CONFIG), latest, corners);
}

export function focusSummary(focus: Focus | null): FocusSummary | null {
  return focus ? { text: focus.text, turn: focus.turn, kind: focus.kind } : null;
}
