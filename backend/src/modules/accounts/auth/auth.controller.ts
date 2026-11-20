import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { LoginDto } from '../dto/login.dto.js';
import { AuthUserResponseDto, MeDto } from '../dto/me.response.dto.js';
import { RegisterDto } from '../dto/register.dto.js';
import { setAuthCookies } from './auth-cookies.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';
import { CurrentUser, Public } from './decorators.js';

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

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ACC-04, ACC-05 Log in',
    description:
      'Sets the httpOnly access_token and refresh_token cookies (ACC-19); tokens are never in the body. Swagger UI keeps the cookie for later calls. Five wrong passwords in a row lock the account for 15 minutes (ACC-05); a successful login resets the count.',
  })
  @ApiOkResponse({ type: AuthUserResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED: email or password missing or malformed',
  })
  @ApiUnauthorizedResponse({
    description:
      'INVALID_CREDENTIALS: invalid email or password. ACCOUNT_LOCKED: 5 failed attempts in a row; the message says how many minutes are left',
  })
  @ApiForbiddenResponse({ description: 'ACCOUNT_SUSPENDED: account suspended' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserResponseDto> {
    const { user, accessToken, refreshToken } = await this.auth.login(dto);
    setAuthCookies(res, { accessToken, refreshToken });
    return { user };
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'ACC-19 Current user' })
  @ApiOkResponse({ type: MeDto })
  @ApiUnauthorizedResponse({
    description:
      'NOT_AUTHENTICATED (no cookie), TOKEN_EXPIRED (refresh, then retry) or SESSION_EXPIRED (log in again)',
  })
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.auth.me(user.id);
  }
}
