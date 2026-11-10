import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Hotel, HotelSchema } from './schemas/hotel.schema.js';
import { RoomNight, RoomNightSchema } from './schemas/room-night.schema.js';
import { Room, RoomSchema } from './schemas/room.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomNight.name, schema: RoomNightSchema },
    ]),
  ],
})
export class HotelsModule {}
