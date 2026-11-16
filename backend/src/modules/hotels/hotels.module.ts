import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module.js';
import { HotelsController } from './hotels.controller.js';
import { HotelsService } from './hotels.service.js';
import { RoomNightInventory } from './room-night-inventory.js';
import { Hotel, HotelSchema } from './schemas/hotel.schema.js';
import { RoomNight, RoomNightSchema } from './schemas/room-night.schema.js';
import { Room, RoomSchema } from './schemas/room.schema.js';

@Module({
  imports: [
    ReferenceDataModule,
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomNight.name, schema: RoomNightSchema },
    ]),
  ],
  controllers: [HotelsController],
  providers: [HotelsService, RoomNightInventory],
  exports: [HotelsService, RoomNightInventory],
})
export class HotelsModule {}
