import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module.js';
import { ItinerariesController } from './itineraries.controller.js';
import { ItinerariesService } from './itineraries.service.js';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
    ReferenceDataModule,
  ],
  controllers: [ItinerariesController],
  providers: [ItinerariesService],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
