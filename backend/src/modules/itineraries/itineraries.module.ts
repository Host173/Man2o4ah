import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsModule } from '../accounts/accounts.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ReferenceDataModule } from '../reference-data/reference-data.module.js';
import { BudgetsController } from './budgets.controller.js';
import { StorageModule } from '../storage/storage.module.js';
import { ActivitiesController } from './activities.controller.js';
import { ItinerariesController } from './itineraries.controller.js';
import { TransportCostsController } from './transport-costs.controller.js';
import { ItinerariesService } from './itineraries.service.js';
import { ItineraryPdf } from './itinerary-pdf.js';
import { ItineraryReportableContent } from './itinerary-reportable-content.js';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
    // ITN-18: the display currency is the ACC-09 preferred currency read
    // through accounts' exported service. FxService comes from AppModule and
    // is looked up lazily, so importing this module does not drag in the fx
    // model (see ItinerariesService.fx()).
    AccountsModule,
    ReferenceDataModule,
    ModerationModule,
    StorageModule,
  ],
  controllers: [
    ItinerariesController,
    ActivitiesController,
    TransportCostsController,
    BudgetsController,
  ],
  providers: [ItinerariesService, ItineraryPdf, ItineraryReportableContent],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
