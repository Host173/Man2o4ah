import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { ProviderType } from '../../accounts/schemas/user.schema.js';

/** Route parameters for `PATCH /api/admin/providers/:type/:id/deactivate` and `/reactivate` (`ACC-15`). */
export class AdminProviderParamsDto {
  @ApiProperty({
    enum: Object.values(ProviderType),
    example: ProviderType.AIRLINE,
    description: 'Provider type (`airline` or `hotel`)',
  })
  @IsEnum(ProviderType)
  type!: ProviderType;

  @ApiProperty({
    example: '6736f0b2c5a1b2c3d4e5f601',
    description: 'Provider ObjectId',
  })
  @IsMongoId()
  id!: string;
}
