import type { ValidationError } from '@nestjs/common';
import { validationExceptionFactory } from './validation-exception.factory.js';

function responseOf(errors: ValidationError[]) {
  const exception = validationExceptionFactory(errors);
  return { status: exception.getStatus(), body: exception.getResponse() };
}

describe('validationExceptionFactory', () => {
  it('turns a flat error into one detail', () => {
    const { status, body } = responseOf([
      { property: 'email', constraints: { isEmail: 'email must be an email' } },
    ]);
    expect(status).toBe(400);
    expect(body).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: [{ field: 'email', message: 'email must be an email' }],
    });
  });

  it('flattens nested errors into dotted paths', () => {
    const { body } = responseOf([
      {
        property: 'passengers',
        children: [
          {
            property: '0',
            children: [
              {
                property: 'firstName',
                constraints: { isNotEmpty: 'firstName should not be empty' },
              },
            ],
          },
        ],
      },
    ]);
    expect(body).toMatchObject({
      details: [
        {
          field: 'passengers.0.firstName',
          message: 'firstName should not be empty',
        },
      ],
    });
  });

  it('joins several constraints of one field into one detail', () => {
    const { body } = responseOf([
      {
        property: 'name',
        constraints: {
          isString: 'name must be a string',
          maxLength: 'name must be shorter than or equal to 5 characters',
        },
      },
    ]);
    expect(body).toMatchObject({
      details: [
        {
          field: 'name',
          message:
            'name must be a string; name must be shorter than or equal to 5 characters',
        },
      ],
    });
  });
});
