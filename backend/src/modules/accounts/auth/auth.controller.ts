import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ChangePasswordDto } from '../dto/change-password.dto.js';
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
    summary: 'ACC-04 Log in',
    description:
      'Sets the httpOnly access_token and refresh_token cookies (ACC-19); tokens are never in the body. Swagger UI keeps the cookie for later calls.',
  })
  @ApiOkResponse({ type: AuthUserResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED: email or password missing or malformed',
  })
  @ApiUnauthorizedResponse({
    description: 'INVALID_CREDENTIALS: invalid email or password',
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

  @Patch('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'ACC-08 Change password',
    description:
      'Also the forced change after a temporary password (ACC-07a): clears mustChangePassword. Logs out every other session; this one stays logged in.',
  })
  @ApiNoContentResponse({ description: 'Password changed.' })
  @ApiBadRequestResponse({
    description:
      'VALIDATION_FAILED: current password wrong or missing, or the new password breaks the rule',
  })
  @ApiUnauthorizedResponse({
    description:
      'NOT_AUTHENTICATED, TOKEN_EXPIRED (refresh, then retry) or SESSION_EXPIRED',
  })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(user.id, user.sid, dto);
  }
}
