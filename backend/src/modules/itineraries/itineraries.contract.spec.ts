import { NotImplementedException } from '@nestjs/common';
import { ItinerariesService } from './itineraries.service.js';

describe('itineraries contract (stubs)', () => {
  const itineraries = new ItinerariesService();

  it('listPublicByAuthor fails explicitly until ITN-20 implements it', () => {
    expect(() => itineraries.listPublicByAuthor('user-1')).toThrow(
      NotImplementedException,
    );
  });
});
