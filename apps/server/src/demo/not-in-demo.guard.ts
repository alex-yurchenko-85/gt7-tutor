import { Injectable, type CanActivate } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { httpError } from '../http-errors.js';

@Injectable()
export class NotInDemoGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.getOrThrow<boolean>('DEMO_MODE')) {
      throw httpError(409, 'demo-mode');
    }
    return true;
  }
}
