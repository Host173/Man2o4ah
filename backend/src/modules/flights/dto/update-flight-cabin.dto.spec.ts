import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateFlightCabinDto } from './update-flight-cabin.dto.js';

describe('UpdateFlightCabinDto', () => {
  it('accepts one or both positive integer fields', async () => {
    for (const input of [
      { priceMinor: 30000 },
      { totalSeats: 1 },
      { priceMinor: 30000, totalSeats: 20 },
      {},
    ]) {
      const dto = plainToInstance(UpdateFlightCabinDto, input);
      await expect(validate(dto)).resolves.toHaveLength(0);
    }
  });

  it.each([
    ['priceMinor', 0],
    ['priceMinor', 1.5],
    ['totalSeats', 0],
    ['totalSeats', -1],
  ])('rejects invalid %s: %p', async (field, value) => {
    const dto = plainToInstance(UpdateFlightCabinDto, { [field]: value });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === field)).toBe(true);
  });
});
