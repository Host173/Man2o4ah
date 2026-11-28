import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import { ProviderType } from '../../accounts/schemas/user.schema.js';
import { ProviderStatus } from '../admin.types.js';

/** Swagger response model for a provider row in `GET /api/admin/providers` (`BE-01`). */
export class AdminProviderResponseDto {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f601' })
  _id!: string;

  @ApiProperty({
    enum: Object.values(ProviderType),
    example: ProviderType.AIRLINE,
  })
  type!: ProviderType;

  @ApiProperty({ example: 'EgyptAir' })
  name!: string;

  @ApiProperty({
    enum: Object.values(ProviderStatus),
    example: ProviderStatus.ACTIVE,
  })
  status!: ProviderStatus;

  @ApiProperty({ example: 2 })
  moderatorCount!: number;

  @ApiPropertyOptional({
    example: 'MS',
    description: 'Present for airlines only',
  })
  code?: string;

  @ApiPropertyOptional({
    example: 'cairo',
    description: 'Present for hotels only',
  })
  cityId?: string;

  @ApiPropertyOptional({
    example: 'EG',
    description: 'Present for hotels only',
  })
  countryCode?: string;
}

/** Swagger response model for `GET /api/admin/providers` (`BE-01`). */
export class PaginatedAdminProvidersResponseDto implements Paginated<AdminProviderResponseDto> {
  @ApiProperty({ type: [AdminProviderResponseDto] })
  items!: AdminProviderResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
