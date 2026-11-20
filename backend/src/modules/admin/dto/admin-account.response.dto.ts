import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type { AccountListItem } from '../../accounts/accounts.types.js';
import {
  ProviderType,
  UserRole,
  UserStatus,
} from '../../accounts/schemas/user.schema.js';

/** Swagger response model for a moderator's assigned provider (`ACC-13`). */
export class ModeratorAssignmentResponseDto {
  @ApiProperty({
    enum: Object.values(ProviderType),
    example: ProviderType.HOTEL,
  })
  providerType!: ProviderType;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f601' })
  providerId!: string;
}

/** Swagger response model for an account row in admin endpoints (`ACC-13`, `ACC-14`). */
export class AdminAccountResponseDto implements AccountListItem {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f610' })
  id!: string;

  @ApiProperty({ example: 'Aisha Al Rawahi' })
  name!: string;

  @ApiProperty({ example: 'aisha@example.com' })
  email!: string;

  @ApiProperty({ enum: Object.values(UserRole), example: UserRole.USER })
  role!: UserRole;

  @ApiProperty({ enum: Object.values(UserStatus), example: UserStatus.ACTIVE })
  status!: UserStatus;

  @ApiPropertyOptional({ type: ModeratorAssignmentResponseDto })
  moderatorOf?: ModeratorAssignmentResponseDto;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-15T12:00:00.000Z',
  })
  createdAt!: Date;
}

/** Swagger response model for `GET /api/admin/accounts` (`ACC-14`). */
export class PaginatedAdminAccountsResponseDto implements Paginated<AdminAccountResponseDto> {
  @ApiProperty({ type: [AdminAccountResponseDto] })
  items!: AdminAccountResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
