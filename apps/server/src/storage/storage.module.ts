import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Knex } from 'knex';
import { KNEX, knexProvider } from './knex.provider.js';

@Global()
@Module({
  providers: [knexProvider],
  exports: [KNEX]
})
export class StorageModule implements OnApplicationShutdown {
  constructor(@Inject(KNEX) private readonly db: Knex) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
