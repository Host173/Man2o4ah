import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ActivitiesController } from './activities.controller.js';
import { ItinerariesController } from './itineraries.controller.js';
import { ItinerariesService } from './itineraries.service.js';
import { ItineraryPdf } from './itinerary-pdf.js';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
    ReferenceDataModule,
    StorageModule,
  ],
  controllers: [ItinerariesController, ActivitiesController],
  providers: [ItinerariesService, ItineraryPdf],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
