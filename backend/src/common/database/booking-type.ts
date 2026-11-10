/** Which booking collection a bookingId points to (data-model 3.7). */
export const BookingType = {
  FLIGHT: 'flight',
  HOTEL: 'hotel',
} as const;
export type BookingType = (typeof BookingType)[keyof typeof BookingType];
