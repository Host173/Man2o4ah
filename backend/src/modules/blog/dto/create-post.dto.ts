import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PostStatus } from '../schemas/post.schema.js';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Request payload for creating a blog post as draft or published (BLG-01). */
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
}
