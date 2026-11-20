import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_POST,
  MIN_TAG_LENGTH,
  normalizeTagsTransform,
} from '../blog-tags.js';
import { PostStatus } from '../schemas/post.schema.js';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Request payload for creating a blog post as draft or published (BLG-01, BLG-08). */
export class CreatePostDto {
  @ApiProperty({ minLength: 1, maxLength: 150, example: 'Three days in Cairo' })
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 20000,
    example: 'Start at the pyramids early in the morning.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  @Matches(/\S/, { message: 'body must not be blank' })
  body!: string;

  @ApiProperty({
    enum: Object.values(PostStatus),
    example: PostStatus.DRAFT,
  })
  @IsIn(Object.values(PostStatus))
  status!: PostStatus;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_TAGS_PER_POST,
    example: ['egypt', 'cairo'],
    description:
      'Optional tags (0–5 tags, each 1–30 characters after trimming; normalised to lowercase and deduplicated)',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => normalizeTagsTransform(value))
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_POST)
  @IsString({ each: true })
  @MinLength(MIN_TAG_LENGTH, { each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  tags?: string[];
}
