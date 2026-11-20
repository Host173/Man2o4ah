import { ApiProperty } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type {
  FlightSearchItem,
  RoundTripSearchResult,
} from '../flights.types.js';
import { AirlineResponseDto } from './airline.response.dto.js';
import { CabinResponseDto, FlightResponseDto } from './flight.response.dto.js';

/** One flight in the search results with the cabins that matched (FLT-11). */
export class FlightSearchItemResponseDto {
  @ApiProperty({ type: FlightResponseDto })
  flight!: FlightResponseDto;

  @ApiProperty({ type: AirlineResponseDto })
  airline!: AirlineResponseDto;

  @ApiProperty({ type: [CabinResponseDto] })
  matchingCabins!: CabinResponseDto[];

  static fromView(view: FlightSearchItem): FlightSearchItemResponseDto {
    return {
      flight: FlightResponseDto.fromView(view.flight),
      airline: AirlineResponseDto.fromView(view.airline),
      matchingCabins: view.matchingCabins.map(({ id, ...cabin }) => ({
        ...cabin,
        _id: id,
      })),
    };
  }
}

/** A page of flight search results. */
export class PaginatedFlightSearchResponseDto implements Paginated<FlightSearchItemResponseDto> {
  @ApiProperty({ type: [FlightSearchItemResponseDto] })
  items!: FlightSearchItemResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;

  static fromView(
    page: Paginated<FlightSearchItem>,
  ): PaginatedFlightSearchResponseDto {
    return {
      ...page,
      items: page.items.map((item) =>
        FlightSearchItemResponseDto.fromView(item),
      ),
    };
  }
}

/** A round-trip search (FLT-12): one page per direction. */
export class RoundTripFlightSearchResponseDto {
  @ApiProperty({ type: PaginatedFlightSearchResponseDto })
  outbound!: PaginatedFlightSearchResponseDto;

  @ApiProperty({ type: PaginatedFlightSearchResponseDto })
  inbound!: PaginatedFlightSearchResponseDto;

  static fromView(
    result: RoundTripSearchResult,
  ): RoundTripFlightSearchResponseDto {
    return {
      outbound: PaginatedFlightSearchResponseDto.fromView(result.outbound),
      inbound: PaginatedFlightSearchResponseDto.fromView(result.inbound),
    };
  }
}
