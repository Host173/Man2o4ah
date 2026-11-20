import { PartialType } from '@nestjs/swagger';
import { CreateAirlineDto } from './create-airline.dto.js';

/** Airline moderator-editable profile fields (FLT-01); status remains admin-managed. */
export class UpdateAirlineDto extends PartialType(CreateAirlineDto, {
  skipNullProperties: false,
}) {}
