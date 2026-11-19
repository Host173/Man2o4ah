import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { validationExceptionFactory } from '../../../common/errors/validation-exception.factory.js';
import { CreateHotelDto } from './create-hotel.dto.js';
import { UpdateHotelDto } from './update-hotel.dto.js';

const profile = {
  name: 'Nile View Hotel',
  address: '1 Corniche El Nil',
  cityId: 'cairo',
};

describe('hotel profile DTOs (HTL-01)', () => {
  it('trims name, address and amenities without rewriting reference IDs', async () => {
    const dto = plainToInstance(CreateHotelDto, {
      ...profile,
      name: '  Nile View Hotel  ',
      address: '  1 Corniche El Nil  ',
      cityId: 'city-ID-Exact',
      amenities: ['  Wi-Fi  ', 'Pool'],
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({
      ...profile,
      cityId: 'city-ID-Exact',
      amenities: ['Wi-Fi', 'Pool'],
    });
  });

  it('accepts maximum profile lengths and star-rating boundaries', async () => {
    for (const starRating of [1, 5]) {
      const dto = plainToInstance(CreateHotelDto, {
        name: 'n'.repeat(150),
        address: 'a'.repeat(300),
        cityId: 'cairo',
        description: 'd'.repeat(5000),
        amenities: ['x'.repeat(50)],
        starRating,
      });
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('rejects empty, oversized, wrongly typed, and duplicate profile values', async () => {
    const invalid = [
      { field: 'name', value: '   ' },
      { field: 'name', value: 'n'.repeat(151) },
      { field: 'address', value: '' },
      { field: 'address', value: 'a'.repeat(301) },
      { field: 'cityId', value: '' },
      { field: 'cityId', value: 123 },
      { field: 'description', value: 'd'.repeat(5001) },
      { field: 'starRating', value: 0 },
      { field: 'starRating', value: 6 },
      { field: 'starRating', value: 3.5 },
      { field: 'starRating', value: '3' },
      { field: 'amenities', value: 'Pool' },
      { field: 'amenities', value: [''] },
      { field: 'amenities', value: ['x'.repeat(51)] },
      { field: 'amenities', value: ['Pool', ' Pool '] },
      { field: 'amenities', value: [123] },
    ];
    for (const { field, value } of invalid) {
      const errors = await validate(
        plainToInstance(CreateHotelDto, { ...profile, [field]: value }),
      );
      expect(errors.map((error) => error.property)).toContain(field);
    }
  });

  it.each(['name', 'address', 'cityId'])(
    'requires %s on creation',
    async (field) => {
      const dto = plainToInstance(CreateHotelDto, {
        ...profile,
        [field]: undefined,
      });
      expect((await validate(dto)).map((error) => error.property)).toContain(
        field,
      );
    },
  );

  it('permits partial edits without filling omitted fields with defaults', async () => {
    const dto = plainToInstance(UpdateHotelDto, { name: '  New Name  ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.name).toBe('New Name');
    expect(dto.address).toBeUndefined();
    expect(dto.cityId).toBeUndefined();
    expect(dto.amenities).toBeUndefined();
  });

  it.each([
    'name',
    'address',
    'cityId',
    'description',
    'starRating',
    'amenities',
  ])('does not allow null to bypass validation for %s', async (field) => {
    const errors = await validate(
      plainToInstance(UpdateHotelDto, { [field]: null }),
    );
    expect(errors.map((error) => error.property)).toContain(field);
  });

  it.each([
    'countryCode',
    'isActive',
    'ratingSummary',
    'photos',
    'checkInTime',
    'cancellationPolicy',
  ])(
    'rejects client-controlled %s through the production validation pipe',
    async (field) => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      });
      for (const metatype of [CreateHotelDto, UpdateHotelDto]) {
        await expect(
          pipe.transform(
            { ...profile, [field]: 'not editable here' },
            { type: 'body', metatype },
          ),
        ).rejects.toMatchObject({
          response: {
            code: ErrorCode.ValidationFailed,
            details: expect.arrayContaining([
              expect.objectContaining({ field }),
            ]),
          },
        });
      }
    },
  );
});
