/** Cabin class of a flight cabin, copied onto booking segments (data-model 3.3, 3.4). */
export const CabinClass = {
  ECONOMY: 'economy',
  PREMIUM_ECONOMY: 'premium_economy',
  BUSINESS: 'business',
  FIRST: 'first',
} as const;
export type CabinClass = (typeof CabinClass)[keyof typeof CabinClass];
