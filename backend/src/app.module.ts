import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { validate } from './config/validate.js';
import { HealthModule } from './health/health.module.js';
import { ReferenceDataModule } from './modules/reference-data/reference-data.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { FlightsModule } from './modules/flights/flights.module.js';
import { FlightBookingsModule } from './modules/flight-bookings/flight-bookings.module.js';
import { HotelsModule } from './modules/hotels/hotels.module.js';
import { HotelBookingsModule } from './modules/hotel-bookings/hotel-bookings.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ItinerariesModule } from './modules/itineraries/itineraries.module.js';
import { FxModule } from './modules/fx/fx.module.js';
import { BlogModule } from './modules/blog/blog.module.js';
import { ModerationModule } from './modules/moderation/moderation.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { AuditModule } from './modules/audit/audit.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    HealthModule,
    ReferenceDataModule,
    AccountsModule,
    FlightsModule,
    FlightBookingsModule,
    HotelsModule,
    HotelBookingsModule,
    PaymentsModule,
    ItinerariesModule,
    FxModule,
    BlogModule,
    ModerationModule,
    NotificationsModule,
    AuditModule,
  ],
})
export class AppModule {}
