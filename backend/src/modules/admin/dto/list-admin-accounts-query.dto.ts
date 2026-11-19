import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { UserRole, UserStatus } from '../../accounts/schemas/user.schema.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Query parameters for `GET /api/admin/accounts` (`ACC-14`). */
export class ListAdminAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'aisha',
    maxLength: 100,
    description:
      'Case-insensitive literal search matching account name or email',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    enum: Object.values(UserRole),
    example: UserRole.USER,
    description: 'Filter accounts by role',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    enum: Object.values(UserStatus),
    example: UserStatus.ACTIVE,
    description: 'Filter accounts by status',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
