import { ConflictException, Injectable, type CanActivate } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class NotInDemoGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.getOrThrow<boolean>('DEMO_MODE')) {
      throw new ConflictException({ code: 'demo-mode', reason: 'Demo mode uses recorded data. This action is not available.' });
    }
    return true;
  }
}
