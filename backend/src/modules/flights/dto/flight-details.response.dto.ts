import { ApiProperty } from '@nestjs/swagger';
import type { FlightManagementView } from '../flights.types.js';
import type { AirlineView } from '../flights.types.js';
import { FlightResponseDto } from './flight.response.dto.js';
import { AirlineResponseDto } from './airline.response.dto.js';

export class FlightDetailsResponseDto extends FlightResponseDto {
  @ApiProperty({ type: AirlineResponseDto })
  airline!: AirlineView;

  static fromDetails(
    flight: FlightManagementView,
    airline: AirlineView,
  ): FlightDetailsResponseDto {
    const response = FlightResponseDto.fromView(flight);
    const result = new FlightDetailsResponseDto();
    Object.assign(result, response);
    result.airline = airline;
    return result;
  }
}
