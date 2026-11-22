import { Controller, Get, Param } from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Types } from 'mongoose';
import { Role } from '../accounts/auth/auth.types.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Roles } from '../accounts/auth/decorators.js';
import { RefundResponseDto } from './dto/refund.response.dto.js';
import type { RefundView } from './payments.types.js';
import { RefundsService } from './refunds.service.js';

@ApiTags('payments')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get(':id')
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'PAY-03 Get the status of one of your refunds',
    description: 'Pending until Stripe confirms it; then Refunded or Failed.',
  })
  @ApiOkResponse({ type: RefundResponseDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED: malformed id' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: not your refund' })
  @ApiParam({ name: 'id', type: String })
  get(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<RefundView> {
    return this.refunds.getOwn(user.id, id.toString());
  }
}
