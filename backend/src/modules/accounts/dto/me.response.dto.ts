import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProviderType, UserRole, UserStatus } from '../schemas/user.schema.js';

export class ModeratorOfDto {
  @ApiProperty({ enum: Object.values(ProviderType) })
  providerType!: ProviderType;

  @ApiProperty({ example: '665f1c2e8b3a4d0012345678' })
  providerId!: string;
}

/**
 * The logged-in account as the frontend sees it (auth.md §4, `MeDto`).
 * Never the password hash, login counters or lock time.
 */
export class MeDto {
  @ApiProperty({ example: '665f1c2e8b3a4d0012345678' })
  _id!: string;

  @ApiProperty({ example: 'Aisha Al Rawahi' })
  name!: string;

  @ApiProperty({ example: 'aisha@example.com' })
  email!: string;

  @ApiProperty({ enum: Object.values(UserRole) })
  role!: UserRole;

  @ApiProperty({ enum: Object.values(UserStatus) })
  status!: UserStatus;

  @ApiProperty({ example: 'USD' })
  preferredCurrency!: string;

  @ApiPropertyOptional({ type: ModeratorOfDto })
  moderatorOf?: ModeratorOfDto;

  @ApiProperty()
  mustChangePassword!: boolean;
}

/** `{ user: MeDto }`, the same shape login returns (auth.md §4). */
export class AuthUserResponseDto {
  @ApiProperty({ type: MeDto })
  user!: MeDto;
}
