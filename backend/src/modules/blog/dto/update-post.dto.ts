import { PartialType } from '@nestjs/swagger';
import { CreatePostDto } from './create-post.dto.js';

/** Partial post update (BLG-04). Omitted fields stay unchanged; null is rejected. */
export class UpdatePostDto extends PartialType(CreatePostDto, {
  skipNullProperties: false,
}) {}
