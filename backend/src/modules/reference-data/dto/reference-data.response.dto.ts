import { ApiProperty } from '@nestjs/swagger';

/** Swagger models of the public reference-data lists. `_id` is the dataset ID. */
export class CountryResponseDto {
  @ApiProperty({ example: 'EG' }) _id!: string;
  @ApiProperty({ example: 'Egypt' }) name!: string;
  @ApiProperty({ example: 'EGP' }) currency!: string;
}

export class CityResponseDto {
  @ApiProperty({ example: 'cairo' }) _id!: string;
  @ApiProperty({ example: 'Cairo' }) name!: string;
  @ApiProperty({ example: 'EG' }) countryCode!: string;
}

export class AirportResponseDto {
  @ApiProperty({ example: 'CAI' }) _id!: string;
  @ApiProperty({ example: 'Cairo International Airport' }) name!: string;
  @ApiProperty({ example: 'cairo' }) cityId!: string;
  @ApiProperty({ example: 'EG' }) countryCode!: string;
  @ApiProperty({ example: 'Africa/Cairo' }) timeZone!: string;
}

export class CurrencyResponseDto {
  @ApiProperty({ example: 'EGP' }) _id!: string;
  @ApiProperty({ example: 'Egyptian Pound' }) name!: string;
  @ApiProperty({ example: 2 }) minorUnits!: number;
}

export class AttractionResponseDto {
  @ApiProperty({ example: 'att-1' }) _id!: string;
  @ApiProperty({ example: 'Giza Pyramids and Sphinx' }) name!: string;
  @ApiProperty({ example: 'cairo' }) cityId!: string;
}

class PageFields {
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 10 }) limit!: number;
  @ApiProperty({ example: 8 }) total!: number;
  @ApiProperty({ example: 1 }) totalPages!: number;
}

export class PaginatedCountriesResponseDto extends PageFields {
  @ApiProperty({ type: [CountryResponseDto] }) items!: CountryResponseDto[];
}

export class PaginatedCitiesResponseDto extends PageFields {
  @ApiProperty({ type: [CityResponseDto] }) items!: CityResponseDto[];
}

export class PaginatedAirportsResponseDto extends PageFields {
  @ApiProperty({ type: [AirportResponseDto] }) items!: AirportResponseDto[];
}

export class PaginatedCurrenciesResponseDto extends PageFields {
  @ApiProperty({ type: [CurrencyResponseDto] }) items!: CurrencyResponseDto[];
}

export class PaginatedAttractionsResponseDto extends PageFields {
  @ApiProperty({ type: [AttractionResponseDto] })
  items!: AttractionResponseDto[];
}
