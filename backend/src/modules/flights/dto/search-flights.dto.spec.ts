import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchFlightsDto } from './search-flights.dto.js';

describe('SearchFlightsDto', () => {
  const valid = {
    from: 'cai',
    to: 'DXB',
    date: '2027-03-14',
    adults: '1',
    children: '0',
    infants: '0',
    sortBy: 'price',
  };

  it('normalizes airports and numeric pagination/price fields', async () => {
    const dto = plainToInstance(SearchFlightsDto, {
      ...valid,
      minPriceMinor: '30000',
      maxPriceMinor: '40000',
      page: '2',
      limit: '10',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({
      from: 'CAI',
      adults: 1,
      children: 0,
      infants: 0,
      minPriceMinor: 30000,
      maxPriceMinor: 40000,
      page: 2,
      limit: 10,
    });
  });

  it.each([
    ['from', 'CA'],
    ['to', 'dxb1'],
    ['date', '2027/03/14'],
    ['adults', '0'],
    ['children', '-1'],
    ['infants', '1.5'],
    ['sortBy', 'name'],
    ['page', '0'],
    ['limit', '51'],
  ])('rejects invalid %s: %p', async (field, value) => {
    const dto = plainToInstance(SearchFlightsDto, {
      ...valid,
      [field]: value,
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === field)).toBe(true);
  });
});
