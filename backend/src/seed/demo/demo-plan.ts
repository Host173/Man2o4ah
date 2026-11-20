import { isValidPassword } from '../../modules/accounts/auth/password-rule.js';

export interface DemoCancellationTier {
  daysBefore: number;
  refundPercent: number;
}

export interface DemoModerator {
  name: string;
  email: string;
}

export interface DemoCabin {
  cabinClass: 'economy' | 'business' | 'first';
  totalSeats: number;
  priceMinor: number;
  freeBags: number;
  maxBagWeightKg: number;
}

export interface DemoRoute {
  flightNumber: string;
  from: string;
  to: string;
  /** Local departure time, `HH:mm`. */
  departureTime: string;
  durationMinutes: number;
  cabins: DemoCabin[];
}

export interface DemoAirline {
  name: string;
  code: string;
  moderator: DemoModerator;
  baggagePolicy: {
    extraBagPriceMinor: number;
    maxExtraBagsPerPassenger: number;
  };
  cancellationTiers: DemoCancellationTier[];
  routes: DemoRoute[];
}

export interface DemoRoom {
  name: string;
  type: string;
  beds: number;
  maxOccupancy: number;
  pricePerNightMinor: number;
}

export interface DemoHotel {
  name: string;
  address: string;
  cityId: string;
  description: string;
  starRating: number;
  amenities: string[];
  moderator: DemoModerator;
  checkInTime: string;
  checkOutTime: string;
  cancellationTiers: DemoCancellationTier[];
  rooms: DemoRoom[];
}

export interface DemoUser {
  name: string;
  email: string;
  preferredCurrency?: string;
}

export interface DemoPlan {
  /** Today, `YYYY-MM-DD` (UTC): the plan's dates are relative to it. */
  today: string;
  /** Flights run on each of the next `flightDays` days, starting tomorrow. */
  flightDays: number;
  /** Rooms are available from today to today + `availabilityDays`. */
  availabilityDays: number;
  admin: { email: string; password: string };
  /** The shared password of every demo account. */
  password: string;
  verbose: boolean;
  airlines: DemoAirline[];
  hotels: DemoHotel[];
  users: DemoUser[];
}

export interface DemoPlanInput {
  password: string | undefined;
  adminEmail: string | undefined;
  adminPassword: string | undefined;
  today: string;
  verbose?: boolean;
}

const AIRLINE_TIERS: DemoCancellationTier[] = [
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 7, refundPercent: 50 },
  { daysBefore: 1, refundPercent: 10 },
];

const HOTEL_TIERS: DemoCancellationTier[] = [
  { daysBefore: 14, refundPercent: 100 },
  { daysBefore: 3, refundPercent: 50 },
  { daysBefore: 1, refundPercent: 0 },
];

/** Economy, Business (about 3x) and, when asked, First (about 5x). */
function cabinsFor(economyMinor: number, withFirst = false): DemoCabin[] {
  const cabins: DemoCabin[] = [
    {
      cabinClass: 'economy',
      totalSeats: 120,
      priceMinor: economyMinor,
      freeBags: 1,
      maxBagWeightKg: 23,
    },
    {
      cabinClass: 'business',
      totalSeats: 20,
      priceMinor: economyMinor * 3,
      freeBags: 2,
      maxBagWeightKg: 32,
    },
  ];
  if (withFirst) {
    cabins.push({
      cabinClass: 'first',
      totalSeats: 8,
      priceMinor: economyMinor * 5,
      freeBags: 3,
      maxBagWeightKg: 32,
    });
  }
  return cabins;
}

function route(
  flightNumber: string,
  from: string,
  to: string,
  departureTime: string,
  durationMinutes: number,
  economyMinor: number,
  withFirst = false,
): DemoRoute {
  return {
    flightNumber,
    from,
    to,
    departureTime,
    durationMinutes,
    cabins: cabinsFor(economyMinor, withFirst),
  };
}

function rooms(basePriceMinor: number): DemoRoom[] {
  return [
    {
      name: 'Standard Double',
      type: 'Standard',
      beds: 1,
      maxOccupancy: 2,
      pricePerNightMinor: basePriceMinor,
    },
    {
      name: 'Deluxe King',
      type: 'Deluxe',
      beds: 1,
      maxOccupancy: 2,
      pricePerNightMinor: Math.round(basePriceMinor * 1.4),
    },
    {
      name: 'Family Room',
      type: 'Family',
      beds: 3,
      maxOccupancy: 4,
      pricePerNightMinor: Math.round(basePriceMinor * 1.8),
    },
    {
      name: 'Suite',
      type: 'Suite',
      beds: 2,
      maxOccupancy: 3,
      pricePerNightMinor: Math.round(basePriceMinor * 2.6),
    },
  ];
}

/**
 * The demo world (PLT-08). Throws a message naming the variable when the
 * password or the admin credentials are missing or too weak.
 */
export function buildDemoPlan(input: DemoPlanInput): DemoPlan {
  const { password, adminEmail, adminPassword } = input;
  if (typeof password !== 'string' || password === '') {
    throw new Error(
      'DEMO_PASSWORD is not set. Add it to backend/.env (see .env.example).',
    );
  }
  if (!isValidPassword(password)) {
    throw new Error(
      'DEMO_PASSWORD must have 8 to 72 characters, including at least one letter and one digit.',
    );
  }
  if (!adminEmail || !adminPassword) {
    throw new Error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set: the demo seed logs in as the admin created by `npm run seed:admin`.',
    );
  }
  return {
    today: input.today,
    flightDays: 14,
    availabilityDays: 90,
    admin: { email: adminEmail, password: adminPassword },
    password,
    verbose: input.verbose ?? false,
    airlines: [
      {
        name: 'Nile Air',
        code: 'NA',
        moderator: {
          name: 'Nile Air Moderator',
          email: 'nile.mod@example.com',
        },
        baggagePolicy: {
          extraBagPriceMinor: 5000,
          maxExtraBagsPerPassenger: 2,
        },
        cancellationTiers: AIRLINE_TIERS,
        routes: [
          route('NA 101', 'CAI', 'DXB', '08:30', 225, 18000),
          route('NA 102', 'DXB', 'CAI', '14:00', 235, 18000),
          route('NA 201', 'CAI', 'LHR', '21:15', 300, 32000),
          route('NA 202', 'LHR', 'CAI', '11:00', 285, 32000),
        ],
      },
      {
        name: 'Gulf Wings',
        code: 'GW',
        moderator: {
          name: 'Gulf Wings Moderator',
          email: 'gulf.mod@example.com',
        },
        baggagePolicy: {
          extraBagPriceMinor: 6000,
          maxExtraBagsPerPassenger: 3,
        },
        cancellationTiers: AIRLINE_TIERS,
        routes: [
          route('GW 301', 'CAI', 'DXB', '14:00', 225, 17000),
          route('GW 302', 'DXB', 'CAI', '21:15', 235, 17000),
          route('GW 401', 'DXB', 'JFK', '02:30', 840, 65000, true),
          route('GW 402', 'JFK', 'DXB', '23:00', 750, 65000, true),
          route('GW 501', 'RUH', 'CAI', '09:00', 160, 12000),
          route('GW 502', 'CAI', 'RUH', '16:30', 165, 12000),
        ],
      },
      {
        name: 'Euro Connect',
        code: 'EC',
        moderator: {
          name: 'Euro Connect Moderator',
          email: 'euro.mod@example.com',
        },
        baggagePolicy: {
          extraBagPriceMinor: 4000,
          maxExtraBagsPerPassenger: 2,
        },
        cancellationTiers: AIRLINE_TIERS,
        routes: [
          route('EC 601', 'LHR', 'CDG', '07:45', 80, 9000),
          route('EC 602', 'CDG', 'LHR', '18:30', 80, 9000),
          route('EC 701', 'CDG', 'FRA', '10:15', 75, 9500),
          route('EC 702', 'FRA', 'CDG', '19:45', 80, 9500),
        ],
      },
    ],
    hotels: [
      {
        name: 'Nile View Hotel',
        address: '1 Corniche El Nil, Cairo',
        cityId: 'cairo',
        description: 'Riverside rooms with views of the Nile.',
        starRating: 4,
        amenities: ['Wi-Fi', 'Breakfast', 'Pool'],
        moderator: {
          name: 'Nile View Moderator',
          email: 'nileview.mod@example.com',
        },
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: HOTEL_TIERS,
        rooms: rooms(9000),
      },
      {
        name: 'Marina Bay Suites',
        address: '12 Marina Walk, Dubai',
        cityId: 'dubai',
        description: 'Modern suites on the marina waterfront.',
        starRating: 5,
        amenities: ['Wi-Fi', 'Gym', 'Pool', 'Spa'],
        moderator: {
          name: 'Marina Moderator',
          email: 'marina.mod@example.com',
        },
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: HOTEL_TIERS,
        rooms: rooms(18000),
      },
      {
        name: 'Thames Court',
        address: '8 Riverside Road, London',
        cityId: 'london',
        description: 'A classic hotel a short walk from the Thames.',
        starRating: 4,
        amenities: ['Wi-Fi', 'Breakfast', 'Bar'],
        moderator: {
          name: 'Thames Moderator',
          email: 'thames.mod@example.com',
        },
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: HOTEL_TIERS,
        rooms: rooms(16000),
      },
      {
        name: 'Seine Garden',
        address: '5 Rue de la Seine, Paris',
        cityId: 'paris',
        description: 'A quiet garden hotel near the Seine.',
        starRating: 3,
        amenities: ['Wi-Fi', 'Garden', 'Breakfast'],
        moderator: { name: 'Seine Moderator', email: 'seine.mod@example.com' },
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: HOTEL_TIERS,
        rooms: rooms(14000),
      },
    ],
    users: [
      {
        name: 'Sara Demo',
        email: 'sara@example.com',
        preferredCurrency: 'EGP',
      },
      { name: 'Omar Demo', email: 'omar@example.com' },
      { name: 'Lina Demo', email: 'lina@example.com' },
    ],
  };
}
