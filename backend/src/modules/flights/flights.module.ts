import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airline, AirlineSchema } from './schemas/airline.schema.js';
import { Flight, FlightSchema } from './schemas/flight.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
    ]),
  ],
})
export class FlightsModule {}
