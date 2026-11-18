import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airport, AirportSchema } from './schemas/airport.schema.js';
import { Attraction, AttractionSchema } from './schemas/attraction.schema.js';
import { City, CitySchema } from './schemas/city.schema.js';
import { Country, CountrySchema } from './schemas/country.schema.js';
import { Currency, CurrencySchema } from './schemas/currency.schema.js';
import { ReferenceDataListsService } from './reference-data-lists.service.js';
import { ReferenceDataController } from './reference-data.controller.js';
import { ReferenceDataService } from './reference-data.service.js';
import { ReferenceDataSeedService } from './seed/reference-data-seed.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Country.name, schema: CountrySchema },
      { name: City.name, schema: CitySchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Attraction.name, schema: AttractionSchema },
      { name: Currency.name, schema: CurrencySchema },
    ]),
  ],
  controllers: [ReferenceDataController],
  providers: [
    ReferenceDataSeedService,
    ReferenceDataService,
    ReferenceDataListsService,
  ],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
