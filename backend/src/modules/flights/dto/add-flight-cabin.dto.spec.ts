import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CabinClass } from '../../../common/database/cabin-class.js';
import { AddFlightCabinDto } from './add-flight-cabin.dto.js';

describe('AddFlightCabinDto', () => {
  const valid = {
    cabinClass: CabinClass.ECONOMY,
    totalSeats: 1,
    priceMinor: 1,
    freeBags: 0,
    maxBagWeightKg: 0.1,
  };

  it('accepts each fixed class and the minimum valid numeric values', async () => {
    for (const cabinClass of Object.values(CabinClass)) {
      const dto = plainToInstance(AddFlightCabinDto, {
        ...valid,
        cabinClass,
      });
      await expect(validate(dto)).resolves.toHaveLength(0);
    }
  });

  it.each([
    ['cabinClass', 'luxury'],
    ['totalSeats', 0],
    ['totalSeats', -1],
    ['totalSeats', 1.5],
    ['totalSeats', Number.MAX_SAFE_INTEGER + 1],
    ['totalSeats', '10'],
    ['priceMinor', 0],
    ['priceMinor', -1],
    ['priceMinor', 1.5],
    ['priceMinor', Number.MAX_SAFE_INTEGER + 1],
    ['priceMinor', '1000'],
    ['freeBags', -1],
    ['freeBags', 1.5],
    ['freeBags', Number.MAX_SAFE_INTEGER + 1],
    ['freeBags', '1'],
    ['maxBagWeightKg', 0],
    ['maxBagWeightKg', -1],
    ['maxBagWeightKg', Number.POSITIVE_INFINITY],
    ['maxBagWeightKg', '23'],
  ])('rejects invalid %s value %s', async (field, value) => {
    const dto = plainToInstance(AddFlightCabinDto, {
      ...valid,
      [field]: value,
    });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it('requires all cabin fields', async () => {
    const errors = await validate(plainToInstance(AddFlightCabinDto, {}));

    expect(errors.map((error) => error.property).sort()).toEqual(
      [
        'cabinClass',
        'freeBags',
        'maxBagWeightKg',
        'priceMinor',
        'totalSeats',
      ].sort(),
    );
  });
});
