import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

export class DeactivateRoomDto {
  @ApiProperty({ enum: [false], description: 'HTL-06 deactivates the room' })
  @Equals(false)
  isActive!: false;
}
