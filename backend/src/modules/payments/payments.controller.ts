import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { Types } from 'mongoose';
import { Role } from '../accounts/auth/auth.types.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Public, Roles } from '../accounts/auth/decorators.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import {
  PaymentResponseDto,
  PaymentSessionResponseDto,
  WebhookAckResponseDto,
} from './dto/payment.response.dto.js';
import { PaymentIntentsService } from './payment-intents.service.js';
import type { PaymentSession, PaymentView } from './payments.types.js';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly intents: PaymentIntentsService) {}

  @Post()
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'PAY-01 Start paying a pending booking with Stripe',
    description:
      "Creates the booking's PaymentIntent (or returns the existing one) and answers with its client secret for Stripe Elements. Card details never reach the backend. The booking is confirmed only by Stripe's webhook. Every amount is charged in the single platform currency, USD (PAY-04).",
  })
  @ApiCreatedResponse({ type: PaymentSessionResponseDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: no such booking of yours' })
  @ApiConflictResponse({
    description:
      'HOLD_EXPIRED, POLICIES_NOT_ACCEPTED or INVALID_STATUS_TRANSITION',
  })
  start(
    @Body() body: CreatePaymentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentSession> {
    return this.intents.start(
      user.id,
      body.bookingType,
      body.bookingId,
      body.changeId,
    );
  }

  // Declared before ':id/retry' so the path can never be read as an id.
  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PAY-01 Stripe webhook (called by Stripe, not by the frontend)',
    description:
      'Stripe calls this with a signed event. The signature is verified on the raw body; only then is the payment updated and the booking told. Repeated deliveries of one event are processed once.',
  })
  @ApiOkResponse({ type: WebhookAckResponseDto })
  @ApiBadRequestResponse({ description: 'BAD_SIGNATURE' })
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<WebhookAckResponseDto> {
    await this.intents.handleWebhook(req.rawBody, signature);
    return { received: true };
  }

  @Post(':id/retry')
  @Roles(Role.USER)
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'PAY-01 Pay again after a failed attempt',
    description:
      'Puts a failed payment back to pending and returns the same client secret, until the hold expires.',
  })
  @ApiOkResponse({ type: PaymentSessionResponseDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED: malformed id' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: not your payment' })
  @ApiConflictResponse({
    description:
      'HOLD_EXPIRED, POLICIES_NOT_ACCEPTED or INVALID_STATUS_TRANSITION',
  })
  @ApiParam({ name: 'id', type: String })
  retry(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentSession> {
    return this.intents.retry(user.id, id.toString());
  }

  @Get(':id')
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'PAY-01 Get the status of one of your payments' })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED: malformed id' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: not your payment' })
  @ApiParam({ name: 'id', type: String })
  get(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentView> {
    return this.intents.get(user.id, id.toString());
  }
}
