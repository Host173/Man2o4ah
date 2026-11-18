import { PartialType } from '@nestjs/swagger';
import { CreateDayDto } from './create-day.dto.js';

/**
 * Partial day update (ITN-05): change the city, the notes or both. Omitted
 * fields stay unchanged; null is rejected.
 */
export class UpdateDayDto extends PartialType(CreateDayDto, {
  skipNullProperties: false,
}) {}
