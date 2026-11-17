import { Controller, Get, Post } from '@nestjs/common';
import type { AppInfo, DemoAttemptResponse } from '@gt7/contracts';
import { Public } from '../auth/public.decorator.js';
import { DemoService } from './demo.service.js';

@Controller()
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Public()
  @Get('app-info')
  appInfo(): AppInfo {
    return this.demo.info();
  }

  @Post('demo/attempt')
  attempt(): DemoAttemptResponse {
    return this.demo.nextAttempt();
  }
}
