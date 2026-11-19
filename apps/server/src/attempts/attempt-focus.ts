import type { FocusSummary } from '@gt7/contracts';
import { DEFAULT_CONFIG, focusSentence, recurring, type Corner, type Finding, type Focus } from '@gt7/core';
import type { Knex } from 'knex';
import { FINDING_COLUMNS, toFinding, type FindingRow } from './finding-rows.js';

export const FOCUS_ATTEMPTS = 8;

export type FocusScope = { exerciseId: string; referenceId: string };

export async function recentFindings(db: Knex, scope: FocusScope, limit: number): Promise<Finding[][]> {
  if (limit <= 0) return [];
  const attempts = await db('attempts')
    .where({ exercise_id: scope.exerciseId, reference_id: scope.referenceId, completion: 'complete' })
    .orderBy([{ column: 'started_at', order: 'desc' }, { column: 'id', order: 'desc' }])
    .limit(limit)
    .select<{ id: string }[]>('id');
  const rows = await db('attempt_findings')
    .whereIn('attempt_id', attempts.map(attempt => attempt.id))
    .andWhere({ reference_id: scope.referenceId })
    .select<FindingRow[]>(...FINDING_COLUMNS);
  return attempts.map(attempt => rows.filter(row => row.attempt_id === attempt.id).map(toFinding));
}

export function focusOf(latestFirst: Finding[][], corners: Corner[]): Focus | null {
  const [latest = []] = latestFirst;
  return focusSentence(recurring(latestFirst, DEFAULT_CONFIG), latest, corners);
}

export function focusSummary(focus: Focus | null): FocusSummary | null {
  return focus ? { text: focus.text, turn: focus.turn, kind: focus.kind } : null;
}
