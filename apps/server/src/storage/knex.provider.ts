import type { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import knex, { type Knex } from 'knex';

export const KNEX = Symbol('KNEX');

export const knexProvider: FactoryProvider<Knex> = {
  provide: KNEX,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    knex({
      client: 'pg',
      connection: config.getOrThrow<string>('DATABASE_URL'),
      pool: { min: 0, max: 10 }
    })
};
