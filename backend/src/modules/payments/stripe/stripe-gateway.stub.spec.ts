import { NotImplementedException } from '@nestjs/common';
import { BookingType } from '../../../common/database/booking-type.js';
import { StripeGatewayStub } from './stripe-gateway.stub.js';

describe('StripeGatewayStub', () => {
  const gateway = new StripeGatewayStub();

  it('createPaymentIntent is not implemented yet (PAY-01)', () => {
    expect(() =>
      gateway.createPaymentIntent({
        amountMinor: 100,
        currency: 'USD',
        metadata: { bookingType: BookingType.FLIGHT, bookingId: 'b-1' },
        idempotencyKey: 'pi-flight-b-1',
      }),
    ).toThrow(NotImplementedException);
  });

  it('cancelPaymentIntent is not implemented yet (PAY-01)', () => {
    expect(() => gateway.cancelPaymentIntent('pi_1')).toThrow(
      NotImplementedException,
    );
  });

  it('createRefund is not implemented yet (PAY-01)', () => {
    expect(() =>
      gateway.createRefund({
        paymentIntentId: 'pi_1',
        amountMinor: 100,
        idempotencyKey: 'refund-r-1',
        metadata: { refundId: 'r-1' },
      }),
    ).toThrow(NotImplementedException);
  });

  it('parseWebhook is not implemented yet (PAY-01)', () => {
    expect(() => gateway.parseWebhook(Buffer.from('{}'), 'sig')).toThrow(
      NotImplementedException,
    );
  });
});
