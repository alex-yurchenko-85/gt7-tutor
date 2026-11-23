import { COMPARISON_VERSION, type Finding, type FocusAttempt } from '@gt7/core';
import type { Knex } from 'knex';

export type FindingRow = {
  attempt_id: string;
  reference_id: string;
  kind: Finding['kind'];
  event_key: string | null;
  s_m: number;
  size: number;
  unit: Finding['unit'];
};

export const FINDING_COLUMNS = ['attempt_id', 'reference_id', 'kind', 'event_key', 's_m', 'size', 'unit'] as const;

export function toFinding(row: FindingRow): Finding {
  return { kind: row.kind, eventKey: row.event_key, sM: row.s_m, size: row.size, unit: row.unit };
}

export function findingRow(attemptId: string, referenceId: string, finding: Finding): FindingRow {
  return {
    attempt_id: attemptId,
    reference_id: referenceId,
    kind: finding.kind,
    event_key: finding.eventKey,
    s_m: finding.sM,
    size: finding.size,
    unit: finding.unit
  };
}

export async function saveComparison(trx: Knex.Transaction, attemptId: string, referenceId: string, comparison: FocusAttempt): Promise<void> {
  const { findings, losses } = comparison;
  const written = await trx.raw<{ rows: { inserted: boolean }[] }>(
    `insert into attempt_comparisons (attempt_id, reference_id, version, turn_losses) values (?, ?, ?, ?::jsonb)
     on conflict (attempt_id, reference_id) do update set version = excluded.version, turn_losses = excluded.turn_losses
     where attempt_comparisons.version < excluded.version
     returning (xmax = 0) as inserted`,
    [attemptId, referenceId, COMPARISON_VERSION, JSON.stringify(losses)]
  );
  const [row] = written.rows;
  if (!row) return;
  if (!row.inserted) await trx('attempt_findings').where({ attempt_id: attemptId, reference_id: referenceId }).delete();
  if (findings.length > 0) await trx('attempt_findings').insert(findings.map(finding => findingRow(attemptId, referenceId, finding)));
}
