import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, ValidateIf } from 'class-validator';
import { ItineraryVisibility } from '../schemas/itinerary.schema.js';
import { CreateItineraryDto } from './create-itinerary.dto.js';

/**
 * Partial itinerary update (ITN-01, ITN-20). Omitted fields stay unchanged;
 * `null` is rejected. ITN-20 adds `visibility`: `public` itineraries appear in
 * shared lists and are read-only to other users; `private` removes them at
 * once.
 */
export class UpdateItineraryDto extends PartialType(CreateItineraryDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({
    enum: Object.values(ItineraryVisibility),
    example: ItineraryVisibility.PUBLIC,
    description:
      'ITN-20: `public` exposes the itinerary in shared lists, read-only to others; `private` is the default.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(ItineraryVisibility)
  visibility?: ItineraryVisibility;
}
