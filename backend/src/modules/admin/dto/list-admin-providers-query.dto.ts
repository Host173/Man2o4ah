import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { ProviderType } from '../../accounts/schemas/user.schema.js';
import { ProviderStatus } from '../admin.types.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Query parameters for `GET /api/admin/providers` (`BE-01`). */
export class ListAdminProvidersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: Object.values(ProviderType),
    example: ProviderType.AIRLINE,
    description: 'Filter providers by type',
  })
  @IsOptional()
  @IsEnum(ProviderType)
  type?: ProviderType;

  @ApiPropertyOptional({
    enum: Object.values(ProviderStatus),
    example: ProviderStatus.ACTIVE,
    description: 'Filter providers by active status',
  })
  @IsOptional()
  @IsEnum(ProviderStatus)
  status?: ProviderStatus;

  @ApiPropertyOptional({
    example: 'egypt',
    maxLength: 100,
    description:
      'Case-insensitive literal search matching provider name (or code for airlines)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}
