import { Injectable, type CanActivate } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { conflict } from '../http-errors.js';

@Injectable()
export class NotInDemoGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.getOrThrow<boolean>('DEMO_MODE')) {
      throw conflict('demo-mode', 'Demo mode uses recorded data. This action is not available.');
    }
    return true;
  }
}
