import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  connectionSettingsSchema,
  gameVersionSchema,
  type ConnectionSettings,
  type GameVersionRequest,
  type Settings
} from '@gt7/contracts';
import { NotInDemoGuard } from '../demo/not-in-demo.guard.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  all(): Promise<Settings> {
    return this.settings.all();
  }

  @Put('connection')
  @UseGuards(NotInDemoGuard)
  async connection(@Body({ schema: connectionSettingsSchema }) body: ConnectionSettings): Promise<Settings> {
    await this.settings.set('ps5Ip', body.ps5Ip);
    return this.settings.all();
  }

  @Put('game-version')
  async gameVersion(@Body({ schema: gameVersionSchema }) body: GameVersionRequest): Promise<Settings> {
    await this.settings.setGameVersion(body.version);
    return this.settings.all();
  }
}
