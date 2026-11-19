import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module.js';
import { FxController } from './fx.controller.js';
import { FX_RATES_CLIENT, FxRatesApiClient } from './fx-rates.client.js';
import { FxRatesService } from './fx-rates.service.js';
import { FxService } from './fx.service.js';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from './schemas/exchange-rate.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
    ]),
    ReferenceDataModule,
  ],
  controllers: [FxController],
  providers: [
    FxService,
    FxRatesService,
    { provide: FX_RATES_CLIENT, useClass: FxRatesApiClient },
  ],
  exports: [FxService],
})
export class FxModule {}
