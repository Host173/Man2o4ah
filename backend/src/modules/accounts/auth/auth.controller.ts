import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthUserResponseDto } from '../dto/me.response.dto.js';
import { RegisterDto } from '../dto/register.dto.js';
import { AuthService } from './auth.service.js';
import { Public } from './decorators.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ACC-01 Register a guest account' })
  @ApiCreatedResponse({
    type: AuthUserResponseDto,
    description: 'Account created. The user is not logged in.',
  })
  @ApiBadRequestResponse({
    description:
      'VALIDATION_FAILED: invalid email or name, password breaks the rule, or consent not given',
  })
  @ApiConflictResponse({ description: 'EMAIL_TAKEN: email already registered' })
  async register(@Body() dto: RegisterDto): Promise<AuthUserResponseDto> {
    return { user: await this.auth.register(dto) };
  }
}
