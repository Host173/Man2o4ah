import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiCookieAuth,
  ApiBadRequestResponse,
  ApiCreatedResponse,
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
import { CurrentUser, Public, Roles } from '../accounts/auth/decorators.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { ImageUpload } from '../storage/image-upload.decorator.js';
import type { UploadedImage } from '../storage/image-rules.js';
import { AirlineResponseDto } from './dto/airline.response.dto.js';
import { CreateAirlineDto } from './dto/create-airline.dto.js';
import { UpdateAirlineDto } from './dto/update-airline.dto.js';
import { UpdateAirlineBaggagePolicyDto } from './dto/update-airline-baggage-policy.dto.js';
import { UpdateAirlineCancellationPolicyDto } from './dto/update-airline-cancellation-policy.dto.js';
import { AirlinesService } from './airlines.service.js';

@ApiTags('flights')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'FLT-01 Admin creates an airline profile' })
  @ApiCreatedResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid airline profile' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  async create(@Body() dto: CreateAirlineDto): Promise<AirlineResponseDto> {
    return AirlineResponseDto.fromView(await this.airlines.create(dto));
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'FLT-01 Get an airline profile' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid airline ID' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  async get(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ): Promise<AirlineResponseDto> {
    const airline = await this.airlines.getAirline(id.toHexString());
    if (!airline) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Airline not found',
      });
    }
    return AirlineResponseDto.fromView(airline);
  }

  @Patch(':id')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'FLT-01 Airline moderator edits their profile' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid airline ID or profile' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Airline moderator role required' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateAirlineDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AirlineResponseDto> {
    return AirlineResponseDto.fromView(
      await this.airlines.update(id.toHexString(), dto, user),
    );
  }

  @Put(':id/baggage-policy')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'FLT-08 Set the assigned airline baggage policy' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid airline ID or baggage policy',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Airline moderator role required' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  async updateBaggagePolicy(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateAirlineBaggagePolicyDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AirlineResponseDto> {
    return AirlineResponseDto.fromView(
      await this.airlines.updateBaggagePolicy(id.toHexString(), dto, user),
    );
  }

  @Put(':id/cancellation-policy')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'FLT-09 Set the assigned airline cancellation tiers',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid airline ID or cancellation tiers',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Airline moderator role required' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  async updateCancellationPolicy(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateAirlineCancellationPolicyDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AirlineResponseDto> {
    return AirlineResponseDto.fromView(
      await this.airlines.updateCancellationPolicy(id.toHexString(), dto, user),
    );
  }

  @Post(':id/logo')
  @Roles(Role.AIRLINE_MODERATOR)
  @ImageUpload()
  @ApiCookieAuth()
  @ApiOperation({ summary: 'FLT-01 Airline moderator uploads their logo' })
  @ApiParam({ name: 'id', type: String })
  @ApiCreatedResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid airline ID or logo' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Airline moderator role required' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  async updateLogo(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<AirlineResponseDto> {
    return AirlineResponseDto.fromView(
      await this.airlines.updateLogo(id.toHexString(), file, user),
    );
  }
}
