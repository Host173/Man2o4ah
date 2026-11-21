import type { Schema } from 'mongoose';
import { SessionSchema } from '../../src/modules/accounts/schemas/session.schema.js';
import { UserSchema } from '../../src/modules/accounts/schemas/user.schema.js';
import { AuditLogSchema } from '../../src/modules/audit/schemas/audit-log.schema.js';
import { CommentSchema } from '../../src/modules/blog/schemas/comment.schema.js';
import { LikeSchema } from '../../src/modules/blog/schemas/like.schema.js';
import { PostSchema } from '../../src/modules/blog/schemas/post.schema.js';
import { PostImageCleanupSchema } from '../../src/modules/blog/schemas/post-image-cleanup.schema.js';
import { FlightBookingSchema } from '../../src/modules/flight-bookings/schemas/flight-booking.schema.js';
import { AirlineSchema } from '../../src/modules/flights/schemas/airline.schema.js';
import { FlightSchema } from '../../src/modules/flights/schemas/flight.schema.js';
import { ExchangeRateSchema } from '../../src/modules/fx/schemas/exchange-rate.schema.js';
import { HotelReservationSchema } from '../../src/modules/hotel-bookings/schemas/hotel-reservation.schema.js';
import { ReviewSchema } from '../../src/modules/hotel-bookings/schemas/review.schema.js';
import { HotelSchema } from '../../src/modules/hotels/schemas/hotel.schema.js';
import { RoomNightSchema } from '../../src/modules/hotels/schemas/room-night.schema.js';
import { RoomSchema } from '../../src/modules/hotels/schemas/room.schema.js';
import { ItinerarySchema } from '../../src/modules/itineraries/schemas/itinerary.schema.js';
import { ReportSchema } from '../../src/modules/moderation/schemas/report.schema.js';
import { NotificationSchema } from '../../src/modules/notifications/schemas/notification.schema.js';
import { EmailDeliverySchema } from '../../src/modules/notifications/schemas/email-delivery.schema.js';
import { PaymentSchema } from '../../src/modules/payments/schemas/payment.schema.js';
import { PolicyAcceptanceSchema } from '../../src/modules/payments/schemas/policy-acceptance.schema.js';
import { RefundSchema } from '../../src/modules/payments/schemas/refund.schema.js';
import { StripeWebhookEventSchema } from '../../src/modules/payments/schemas/stripe-webhook-event.schema.js';
import { AirportSchema } from '../../src/modules/reference-data/schemas/airport.schema.js';
import { AttractionSchema } from '../../src/modules/reference-data/schemas/attraction.schema.js';
import { CitySchema } from '../../src/modules/reference-data/schemas/city.schema.js';
import { CountrySchema } from '../../src/modules/reference-data/schemas/country.schema.js';
import { CurrencySchema } from '../../src/modules/reference-data/schemas/currency.schema.js';

/** The 29 collections of data-model §2, each with its Mongoose schema. */
export const ALL_SCHEMAS: Record<string, Schema> = {
  countries: CountrySchema,
  cities: CitySchema,
  airports: AirportSchema,
  attractions: AttractionSchema,
  currencies: CurrencySchema,
  users: UserSchema,
  sessions: SessionSchema,
  airlines: AirlineSchema,
  flights: FlightSchema,
  flight_bookings: FlightBookingSchema,
  hotels: HotelSchema,
  rooms: RoomSchema,
  room_nights: RoomNightSchema,
  hotel_reservations: HotelReservationSchema,
  reviews: ReviewSchema,
  payments: PaymentSchema,
  refunds: RefundSchema,
  policy_acceptances: PolicyAcceptanceSchema,
  stripe_webhook_events: StripeWebhookEventSchema,
  itineraries: ItinerarySchema,
  exchange_rates: ExchangeRateSchema,
  posts: PostSchema,
  comments: CommentSchema,
  likes: LikeSchema,
  post_image_cleanups: PostImageCleanupSchema,
  reports: ReportSchema,
  notifications: NotificationSchema,
  email_deliveries: EmailDeliverySchema,
  audit_logs: AuditLogSchema,
};
