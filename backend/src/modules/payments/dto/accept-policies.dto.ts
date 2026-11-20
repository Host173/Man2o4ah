import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

/** The acceptance checkbox (PAY-02): only `true` is accepted. */
export class AcceptPoliciesDto {
  @ApiProperty({ enum: [true], example: true })
  @IsBoolean()
  @Equals(true, { message: 'accepted must be true' })
  accepted!: true;
}
