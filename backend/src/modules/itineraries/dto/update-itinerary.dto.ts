import { PartialType } from '@nestjs/swagger';
import { CreateItineraryDto } from './create-itinerary.dto.js';

/** Partial itinerary update (ITN-01). Omitted fields stay unchanged; null is rejected. */
export class UpdateItineraryDto extends PartialType(CreateItineraryDto, {
  skipNullProperties: false,
}) {}
