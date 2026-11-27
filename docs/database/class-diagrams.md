# Class Diagrams — Travel Platform

Generated from `data-model.md`. If they disagree, `data-model.md` wins.

**How to read them**

- Each yellow box is a module; classes inside it are the collections that module owns.
- **Filled diamond (composition) = embedded.** The child lives inside the parent document and is deleted with it.
- **Solid arrow = reference by ID inside the same module.**
- **Dashed arrow = reference by ID to another module's collection.** Only that module's service may read it.
- `<<embedded>>` marks subdocuments, not collections. Enum values are written `a/b/c`.
- Rendered SVGs are in `diagrams/` next to each `.mmd` source.

## Overview

```mermaid
classDiagram
  direction TB
  namespace reference_data {
    class countries
    class cities
    class airports
    class attractions
    class currencies
  }
  namespace accounts {
    class users
    class sessions
  }
  namespace flights {
    class airlines
    class flights_["flights"]
  }
  namespace flight_bookings {
    class flight_bookings_["flight_bookings"]
  }
  namespace hotels {
    class hotels_["hotels"]
    class rooms
    class room_nights
  }
  namespace hotel_bookings {
    class hotel_reservations
    class reviews
  }
  namespace payments {
    class payments_["payments"]
    class refunds
    class policy_acceptances
    class stripe_webhook_events
  }
  namespace itineraries {
    class itineraries_["itineraries"]
  }
  namespace fx {
    class exchange_rates
  }
  namespace blog {
    class posts
    class comments
    class likes
    class post_image_cleanups
  }
  namespace moderation {
    class reports
  }
  namespace notifications {
    class notifications_["notifications"]
  }
  namespace audit {
    class audit_logs
  }

  cities --> countries
  airports --> cities
  attractions --> cities
  countries --> currencies
  sessions --> users
  flights_ --> airlines
  flights_ ..> airports
  rooms --> hotels_
  room_nights --> rooms
  room_nights ..> hotel_reservations
  hotels_ ..> cities
  flight_bookings_ ..> flights_
  hotel_reservations ..> hotels_
  hotel_reservations ..> rooms
  reviews --> hotel_reservations
  payments_ ..> flight_bookings_
  payments_ ..> hotel_reservations
  refunds --> payments_
  policy_acceptances ..> flight_bookings_
  policy_acceptances ..> hotel_reservations
  itineraries_ ..> cities
  posts ..> itineraries_ : itineraryId (optional, BLG-13)
  comments --> posts
  likes --> posts
  post_image_cleanups --> posts : deleted postId (parent may be absent)
  reports ..> posts : target (post, comment, review, itinerary)
```

## Accounts Reference

```mermaid
classDiagram
  direction LR
  namespace reference_data {
    class Country {
      _id : string (code)
      name : string
      currency : string
    }
    class City {
      _id : string (city_id)
      name : string
      countryCode : string
    }
    class Airport {
      _id : string (iata_code)
      name : string
      cityId : string
      countryCode : string
      timeZone : string (IANA)
    }
    class Attraction {
      _id : string (attraction_id)
      name : string
      cityId : string
    }
    class Currency {
      _id : string (ISO code)
      name : string
      minorUnits : int
    }
  }
  namespace accounts {
    class User {
      name : string
      email : string unique
      passwordHash : string
      role : user/admin/airline_moderator/hotel_moderator
      status : active/suspended/deactivated
      phone : string?
      preferredCurrency : string
      moderatorOf : ModeratorOf?
      mustChangePassword : boolean
      termsAcceptedAt : Date?
      failedLoginAttempts : int
      lockedUntil : Date?
    }
    class ModeratorOf {
      <<embedded>>
      providerType : airline/hotel
      providerId : ObjectId
    }
    class Session {
      userId : ObjectId
      refreshTokenHash : string
      lastActivityAt : Date
      expiresAt : Date (TTL)
      absoluteExpiresAt : Date (immutable)
    }
  }
  City --> Country : countryCode
  Airport --> City : cityId
  Attraction --> City : cityId
  Country --> Currency : currency
  User *-- "0..1" ModeratorOf
  User ..> Currency : preferredCurrency
  Session "*" --> "1" User : userId
```

## Flights

```mermaid
classDiagram
  direction LR
  namespace flights {
    class Airline {
      name : string
      code : string unique
      logo : ImageRef?
      isActive : boolean
      baggagePolicy : BaggagePolicy
      cancellationPolicy.tiers : CancellationTier[]
    }
    class BaggagePolicy {
      <<embedded>>
      extraBagPriceMinor : int?
      maxExtraBagsPerPassenger : int
    }
    class CancellationTier {
      <<embedded>>
      daysBefore : int unique in list
      refundPercent : int 0-100
    }
    class Flight {
      airlineId : ObjectId
      flightNumber : string
      departureAirportId : string
      arrivalAirportId : string
      departureAt : Date UTC
      arrivalAt : Date UTC
      departureLocalDate : YYYY-MM-DD
      durationMinutes : int
      status : scheduled/cancelled/departed
      hasBookings : boolean
      cabins : Cabin[]
    }
    class Cabin {
      <<embedded>>
      cabinClass : economy/premium_economy/business/first
      totalSeats : int
      availableSeats : int
      heldSeats : int
      bookedSeats : int
      priceMinor : int
      freeBags : int
      maxBagWeightKg : number
    }
  }
  namespace flight_bookings {
    class FlightBooking {
      userId : ObjectId
      reference : string? unique
      status : pending_payment/confirmed/completed/expired/cancelled
      tripType : one_way/round_trip
      segments : FlightSegment[]
      passengers : Passenger[]
      seatCount : int
      pricing : Pricing
      holdExpiresAt : Date
      firstDepartureAt : Date
      lastDepartureAt : Date
      cancellation : Cancellation?
      pendingChange : PendingFlightChange?
      changes : FlightChange[]?
    }
    class FlightSegment {
      <<embedded>>
      direction : outbound/return
      flightId : ObjectId
      cabinId : ObjectId
      cabinClass : string
      airlineId, flightNumber : copies
      departureAt, arrivalAt : synced copies
      fareMinor : int snapshot
      policy : SegmentPolicy snapshot
    }
    class Passenger {
      <<embedded>>
      type : adult/child/infant
      fullName : string
      dateOfBirth : DateOnly
      documentNumber : string
      extraBagCount : int
      extraBagWeightKg : number
    }
    class Cancellation {
      <<embedded>>
      cancelledAt : Date
      cancelledBy : user/provider
      refundPercent : int
      refundAmountMinor : int
    }
    class PendingFlightChange {
      <<embedded>>
      _id : ObjectId change ID
      direction : outbound/return
      segment : FlightSegment snapshot
      pricing : Pricing after the change
      differenceMinor : int > 0
      holdExpiresAt : Date
      requestedAt : Date
    }
    class FlightChange {
      <<embedded>>
      _id : ObjectId change ID
      direction : outbound/return
      previousSegment : FlightSegment snapshot
      newFlightId : ObjectId
      previousTotalMinor, newTotalMinor : int
      differenceMinor : int
      changedAt : Date
    }
  }
  Airline *-- BaggagePolicy
  Airline *-- "0..*" CancellationTier
  Flight "*" --> "1" Airline : airlineId
  Flight *-- "0..4" Cabin
  FlightBooking *-- "1..2" FlightSegment
  FlightBooking *-- "1..*" Passenger
  FlightBooking *-- "0..1" Cancellation
  FlightBooking *-- "0..1" PendingFlightChange
  FlightBooking *-- "0..*" FlightChange
  FlightSegment ..> Flight : flightId + cabinId
```

## Hotels

```mermaid
classDiagram
  direction LR
  namespace hotels {
    class Hotel {
      name : string
      address : string
      cityId : string
      countryCode : string
      description : string?
      photos : ImageRef[0..5]
      starRating : int?
      amenities : string[]
      checkInTime : HH:mm
      checkOutTime : HH:mm
      cancellationPolicy.tiers : CancellationTier[]
      isActive : boolean
      ratingSummary : average, count
    }
    class Room {
      hotelId : ObjectId
      name : string unique in hotel
      type : string
      beds : int
      maxOccupancy : int
      pricePerNightMinor : int
      isActive : boolean
      availability : AvailabilityRange[]
      hasEverBeenReserved : boolean
      inventoryVersion : int
    }
    class AvailabilityRange {
      <<embedded>>
      fromDate : DateOnly
      toDate : DateOnly inclusive
    }
    class RoomNight {
      roomId : ObjectId
      hotelId : ObjectId
      date : DateOnly
      kind : reservation/blocked
      reservationId : ObjectId?
      blockId : ObjectId?
    }
  }
  namespace hotel_bookings {
    class HotelReservation {
      userId : ObjectId
      hotelId : ObjectId
      reference : string? unique
      status : pending_payment/confirmed/completed/expired/cancelled
      checkInDate : DateOnly
      checkOutDate : DateOnly
      nights : int
      rooms : ReservedRoom[]
      totalMinor : int
      currency : string
      policySnapshot : tiers, checkIn/Out times
      holdExpiresAt : Date
      cancellation : Cancellation?
    }
    class ReservedRoom {
      <<embedded>>
      roomId : ObjectId
      roomName, roomType : snapshots
      pricePerNightMinor : int snapshot
      adults : int
      childAges : int[]
      subtotalMinor : int
    }
    class Review {
      reservationId : ObjectId unique
      hotelId : ObjectId
      userId : ObjectId
      rating : int 1-5
      text : string?
      isHidden : boolean
    }
  }
  Room "*" --> "1" Hotel : hotelId
  Room *-- "0..*" AvailabilityRange
  RoomNight "*" --> "1" Room : roomId (unique roomId+date)
  RoomNight ..> HotelReservation : reservationId
  HotelReservation *-- "1..*" ReservedRoom
  HotelReservation ..> Hotel : hotelId
  ReservedRoom ..> Room : roomId
  Review "0..1" --> "1" HotelReservation : reservationId
```

## Payments

```mermaid
classDiagram
  direction LR
  namespace payments {
    class Payment {
      bookingType : flight/hotel
      bookingId : ObjectId
      userId : ObjectId
      stripePaymentIntentId : string unique
      amountMinor : int
      currency : string
      status : pending/failed/succeeded/canceled
    }
    class Refund {
      paymentId : ObjectId
      bookingType : flight/hotel
      bookingId : ObjectId
      userId : ObjectId
      stripeRefundId : string?
      amountMinor : int
      currency : string
      reason : user_cancellation/provider_cancellation/late_payment/booking_change
      changeId : ObjectId? FLT-27
      status : pending/refunded/failed
    }
    class PolicyAcceptance {
      bookingType : flight/hotel
      bookingId : ObjectId
      userId : ObjectId
      acceptedAt : Date
    }
    class StripeWebhookEvent {
      _id : string (Stripe event id)
      type : string
      receivedAt : Date (TTL 30d)
    }
  }
  class FlightBooking {
    <<flight-bookings>>
  }
  class HotelReservation {
    <<hotel-bookings>>
  }
  Refund "0..1" --> "1" Payment : paymentId
  Payment ..> FlightBooking : bookingType + bookingId
  Payment ..> HotelReservation : bookingType + bookingId
  PolicyAcceptance ..> FlightBooking : bookingType + bookingId
  PolicyAcceptance ..> HotelReservation : bookingType + bookingId
```

## Itineraries Fx

```mermaid
classDiagram
  direction LR
  namespace itineraries {
    class Itinerary {
      ownerId : ObjectId
      title : string
      countryCodes : string[]
      startDate : DateOnly
      visibility : private/public
      isHidden : boolean
      authorDeactivated : boolean
      clonedFrom : itineraryId, authorId
      days : Day[0..60]
      transportCosts : TransportCost[]
      dayCount : int derived
      cityIds : string[] derived
    }
    class Day {
      <<embedded>>
      cityId : string
      notes : string?
      activities : Activity[]
      budgetEntries : BudgetEntry[]
    }
    class Activity {
      <<embedded>>
      name : string
      description : string?
      time : HH:mm?
      cost : amountMinor, currency
      images : ImageRef[0..5]
      attractionId : string?
    }
    class BudgetEntry {
      <<embedded>>
      category : food/accommodation/in_city_transport/activities
      amountMinor : int
      currency : string
      note : string?
    }
    class TransportCost {
      <<embedded>>
      dayId : ObjectId
      mode : flight/train/bus/car/ferry/other
      fromCityId : string
      toCityId : string
      amountMinor : int
      currency : string
    }
  }
  namespace fx {
    class ExchangeRate {
      rateDate : DateOnly unique
      base : string
      rates : Map~string, number~
      fetchedAt : Date
      source : string
    }
  }
  Itinerary *-- "0..60" Day
  Itinerary *-- "0..*" TransportCost
  Day *-- "0..*" Activity
  Day *-- "0..*" BudgetEntry
  TransportCost ..> Day : dayId
```

## Community

```mermaid
classDiagram
  direction LR
  namespace blog {
    class Post {
      authorId : ObjectId
      itineraryId : ObjectId?
      title : string
      body : string
      tags : string[0..5]
      images : ImageRef[0..5]
      status : draft/published
      publishedAt : Date?
      likeCount : int
      commentCount : int
      isHidden : boolean
      authorDeactivated : boolean
    }
    class Comment {
      postId : ObjectId
      authorId : ObjectId
      body : string
      isHidden : boolean
    }
    class Like {
      postId : ObjectId
      userId : ObjectId
    }
    class PostImageCleanup {
      postId : ObjectId
      key : string (unique)
    }
  }
  namespace moderation {
    class Report {
      reporterId : ObjectId
      targetType : post/comment/review/itinerary
      targetId : ObjectId
      reason : string
      status : open/dismissed/content_hidden/content_deleted
      resolvedBy : ObjectId?
      resolvedAt : Date?
    }
  }
  namespace notifications {
    class Notification {
      userId : ObjectId
      type : string
      title : string
      message : string
      entity : type, id
      readAt : Date?
    }
  }
  namespace audit {
    class AuditLog {
      actorId : ObjectId
      action : string
      target : type, id
      details : object
      createdAt : Date
    }
  }
  namespace itineraries {
    class Itinerary
  }
  Comment "*" --> "1" Post : postId
  Post "*" ..> "0..1" Itinerary : itineraryId (BLG-13)
  Like "*" --> "1" Post : postId (unique postId+userId)
  PostImageCleanup "*" --> "0..1" Post : postId (survives deletion)
  Report ..> Post : targetType + targetId
  Report ..> Comment : targetType + targetId
```
