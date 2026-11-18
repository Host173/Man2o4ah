import { PartialType } from '@nestjs/swagger';
import { CreateHotelDto } from './create-hotel.dto.js';

/** Omitted fields remain unchanged; null does not bypass field validation. */
export class UpdateHotelDto extends PartialType(CreateHotelDto, {
  skipNullProperties: false,
}) {}
