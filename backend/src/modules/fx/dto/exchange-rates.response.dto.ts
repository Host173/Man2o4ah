import { ApiProperty } from '@nestjs/swagger';

/** Swagger model of `GET /api/exchange-rates/latest` (ITN-18). */
export class ExchangeRatesResponseDto {
  @ApiProperty({
    example: 'USD',
    description: 'Every rate is per 1 unit of this currency',
  })
  base!: string;

  @ApiProperty({ example: '2026-11-19', description: 'UTC date of the rates' })
  rateDate!: string;

  @ApiProperty({ example: '2026-11-19T00:05:01.123Z' })
  fetchedAt!: string;

  @ApiProperty({ example: 'fxratesapi' })
  source!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { USD: 1, EGP: 50.12 },
  })
  rates!: Record<string, number>;
}
