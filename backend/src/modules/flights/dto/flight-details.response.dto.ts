import { ApiProperty } from '@nestjs/swagger';
import type { AirlineView, FlightManagementView } from '../flights.types.js';
import { FlightResponseDto } from './flight.response.dto.js';
import { AirlineResponseDto } from './airline.response.dto.js';

export class FlightDetailsResponseDto extends FlightResponseDto {
  @ApiProperty({ type: AirlineResponseDto })
  airline!: AirlineResponseDto;

  static fromDetails(
    flight: FlightManagementView,
    airline: AirlineView,
  ): FlightDetailsResponseDto {
    const response = FlightResponseDto.fromView(flight);
    const result = new FlightDetailsResponseDto();
    Object.assign(result, response);
    result.airline = AirlineResponseDto.fromView(airline);
    return result;
  }
}
