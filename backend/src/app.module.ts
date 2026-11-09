import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { validate } from './config/validate.js';
import { HealthModule } from './health/health.module.js';
import { ReferenceDataModule } from './modules/reference-data/reference-data.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { FlightsModule } from './modules/flights/flights.module.js';
import { FlightBookingsModule } from './modules/flight-bookings/flight-bookings.module.js';
import { HotelsModule } from './modules/hotels/hotels.module.js';
import { HotelBookingsModule } from './modules/hotel-bookings/hotel-bookings.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    HealthModule,
    ReferenceDataModule,
    AccountsModule,
    FlightsModule,
    FlightBookingsModule,
    HotelsModule,
    HotelBookingsModule,
    PaymentsModule,
  ],
})
export class AppModule {}
