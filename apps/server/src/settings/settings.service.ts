import { Inject, Injectable } from '@nestjs/common';
import type { Settings } from '@gt7/contracts';
import type { Knex } from 'knex';
import { KNEX } from '../storage/knex.provider.js';

type SettingKey = keyof Settings;

@Injectable()
export class SettingsService {
  constructor(@Inject(KNEX) private readonly db: Knex) {}

  async all(): Promise<Settings> {
    const rows = await this.db('settings').whereIn('key', ['ps5Ip', 'gameVersion']).select<{ key: SettingKey; value: string }[]>('key', 'value');
    const value = (key: SettingKey) => rows.find(row => row.key === key)?.value ?? null;
    return { ps5Ip: value('ps5Ip'), gameVersion: value('gameVersion') };
  }

  async get(key: SettingKey): Promise<string | null> {
    return (await this.all())[key];
  }

  async set(key: SettingKey, value: string, trx: Knex | Knex.Transaction = this.db): Promise<void> {
    await trx('settings')
      .insert({ key, value: JSON.stringify(value), updated_at: trx.fn.now() })
      .onConflict('key')
      .merge(['value', 'updated_at']);
  }

  async setGameVersion(version: string): Promise<void> {
    await this.db.transaction(async trx => {
      await this.set('gameVersion', version, trx);
      await trx('references').whereRaw('game_version is distinct from ?', [version]).update({ needs_check: true });
    });
  }
}
