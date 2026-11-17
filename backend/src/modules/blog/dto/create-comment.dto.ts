import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Request payload for commenting on a published blog post (BLG-05). */
export class CreateCommentDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 500,
    example: 'Great tips for visiting Siwa Oasis!',
  })
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;
}
