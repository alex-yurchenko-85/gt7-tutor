import { describe, expect, it } from 'vitest';
import { dbResetPlan } from './db-reset.ts';

describe('pnpm db:reset', () => {
  it('db_reset_plan_drops_creates_and_migrates', () => {
    expect(dbResetPlan('postgres://gt7:gt7@127.0.0.1:5432/gt7_tutor')).toEqual([
      { kind: 'drop-database', name: 'gt7_tutor' },
      { kind: 'create-database', name: 'gt7_tutor' },
      { kind: 'migrate', databaseUrl: 'postgres://gt7:gt7@127.0.0.1:5432/gt7_tutor' }
    ]);
  });
});
