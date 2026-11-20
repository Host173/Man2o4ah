import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Role } from '../accounts/auth/auth.types.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Roles } from '../accounts/auth/decorators.js';
import { AcceptPoliciesDto } from './dto/accept-policies.dto.js';
import { BookingParamsDto } from './dto/booking-params.dto.js';
import {
  FlightPoliciesResponseDto,
  HotelPoliciesResponseDto,
  PolicyAcceptanceResponseDto,
} from './dto/policies.response.dto.js';
import type {
  BookingPoliciesView,
  PolicyAcceptanceView,
} from './payments.types.js';
import { PolicyAcceptancesService } from './policy-acceptances.service.js';

// Payments owns these routes even though the URL says `bookings`.
@ApiTags('payments')
@Controller('bookings')
export class PoliciesController {
  constructor(private readonly acceptances: PolicyAcceptancesService) {}

  @Get(':type/:id/policies')
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'PAY-02 Show the policies of one of your bookings',
    description:
      "The booking's policy snapshot (airline: cancellation tiers and baggage per segment; hotel: cancellation tiers and check-in/out times), and whether and when it was accepted. Works in any booking status.",
  })
  @ApiExtraModels(FlightPoliciesResponseDto, HotelPoliciesResponseDto)
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(FlightPoliciesResponseDto) },
        { $ref: getSchemaPath(HotelPoliciesResponseDto) },
      ],
    },
  })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: no such booking of yours' })
  getPolicies(
    @Param() params: BookingParamsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<BookingPoliciesView> {
    return this.acceptances.getPolicies(user.id, params.type, params.id);
  }

  // 200 on the first call and on repeats: an idempotent action on the booking,
  // not the creation of a resource the client addresses later.
  @Post(':type/:id/accept-policies')
  @Roles(Role.USER)
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'PAY-02 Accept the policies of one of your bookings',
    description:
      'Payment is blocked until this is called. The server stores the time of the acceptance; repeating the call returns the first acceptance unchanged. Refused once the booking is paid or its hold is over.',
  })
  @ApiOkResponse({ type: PolicyAcceptanceResponseDto })
  @ApiBadRequestResponse({
    description:
      'VALIDATION_FAILED: the body must be exactly { accepted: true }',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: no such booking of yours' })
  @ApiConflictResponse({
    description: 'HOLD_EXPIRED or INVALID_STATUS_TRANSITION',
  })
  accept(
    @Param() params: BookingParamsDto,
    // Validated (only `{ accepted: true }` passes); nothing else to read.
    @Body() body: AcceptPoliciesDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PolicyAcceptanceView> {
    void body;
    return this.acceptances.accept(user.id, params.type, params.id);
  }
}
