import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module.js';
import { FlightsController } from './flights.controller.js';
import { FlightsService } from './flights.service.js';
import { SeatInventory } from './seat-inventory.js';
import { Airline, AirlineSchema } from './schemas/airline.schema.js';
import { Flight, FlightSchema } from './schemas/flight.schema.js';

@Module({
  imports: [
    ReferenceDataModule,
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
    ]),
  ],
  controllers: [FlightsController],
  providers: [FlightsService, SeatInventory],
  // SeatInventory is exported on purpose: flight-bookings calls hold/confirm/release
  // inside its own transaction (data-model 4.1, skill 3.4).
  exports: [FlightsService, SeatInventory],
})
export class FlightsModule {}
