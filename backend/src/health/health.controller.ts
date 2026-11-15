import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Public } from '../modules/accounts/auth/decorators.js';

/** Open to everyone: uptime checks don't log in. */
@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  check() {
    return {
      status: 'ok',
      database: this.connection.readyState === 1 ? 'up' : 'down',
    };
  }
}
