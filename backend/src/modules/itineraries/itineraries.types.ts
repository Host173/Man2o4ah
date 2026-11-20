/*
 * The contract types of the itineraries module (CTR-06) and the views its HTTP
 * endpoints return (ITN-01, ITN-03). Views are plain objects: IDs are strings,
 * never ObjectIds, so other modules and the fakes don't depend on Mongoose.
 * The service maps documents to these views.
 */

import type {
  BudgetCategory,
  ItineraryVisibility,
  TransportMode,
} from './schemas/itinerary.schema.js';

/** An image attached to an activity (GEN-08). */
export interface ActivityImageView {
  _id: string;
  key: string;
}

/** An activity's own cost; counted under Activities in the budget (ITN-14). */
export interface ActivityCostView {
  amountMinor: number;
  currency: string;
}

/** An activity of an itinerary day (ITN-10). */
export interface ActivityView {
  _id: string;
  name: string;
  description?: string;
  /** `HH:mm`. */
  time?: string;
  cost?: ActivityCostView;
  images: ActivityImageView[];
  attractionId?: string;
}

/** ITN-10: the accepted payload when adding an activity to a day. */
export interface AddActivityInput {
  name: string;
  description?: string;
  /** `HH:mm`. */
  time?: string;
  cost?: ActivityCostView;
}

/** ITN-10: the accepted payload when editing an activity; omitted fields stay. */
export interface UpdateActivityInput {
  name?: string;
  description?: string;
  /** `HH:mm`. */
  time?: string;
  cost?: ActivityCostView;
}

/** A budget entry of an itinerary day (ITN-14). */
export interface BudgetEntryView {
  _id: string;
  category: BudgetCategory;
  amountMinor: number;
  currency: string;
  note?: string;
}

/** One day of an itinerary. The number and date derive from the array order (ITN-05). */
export interface ItineraryDayView {
  _id: string;
  /** Position in the array + 1. */
  dayNumber: number;
  /** `startDate` + (dayNumber - 1) days, `YYYY-MM-DD`. */
  date: string;
  cityId: string;
  notes?: string;
  activities: ActivityView[];
  budgetEntries: BudgetEntryView[];
}

/** A group of consecutive days in the same city, computed on read (ITN-09). */
export interface CityGroupView {
  cityId: string;
  /** The first day of the group (day number). */
  fromDay: number;
  /** The last day of the group (day number). */
  toDay: number;
  /** Days in the group. */
  dayCount: number;
  /** The first day's date, `YYYY-MM-DD`. */
  checkIn: string;
  /** The day after the last day's date, `YYYY-MM-DD` (ITN-25). */
  checkOut: string;
}

/** Intercity transport cost of an itinerary (ITN-16). */
export interface TransportCostView {
  _id: string;
  dayId: string;
  mode: TransportMode;
  fromCityId: string;
  toCityId: string;
  amountMinor: number;
  currency: string;
}

/**
 * An itinerary as the owner's list (ITN-03) shows it: `days` is the stored
 * `dayCount`, and the details of each day are loaded by opening the itinerary.
 */
export interface ItinerarySummary {
  _id: string;
  /** The owner (the itinerary's `ownerId`). */
  ownerId: string;
  title: string;
  /** → countries (by code). */
  countryCodes: string[];
  /** UTC calendar date, `YYYY-MM-DD` (ITN-01). */
  startDate: string;
  /** `days.length` (ITN-05). */
  dayCount: number;
  /** ITN-01, ITN-20; `private` by default. */
  visibility: ItineraryVisibility;
  createdAt: Date;
  updatedAt: Date;
}

/** An itinerary with its full details (ITN-03). */
export interface ItineraryDetailView extends ItinerarySummary {
  days: ItineraryDayView[];
  /** Consecutive same-city days, computed on read (ITN-09). */
  cityGroups: CityGroupView[];
  transportCosts: TransportCostView[];
  isHidden: boolean;
  authorDeactivated: boolean;
  clonedFrom?: { itineraryId: string; authorId: string };
}

/**
 * A public itinerary as the author page (BLG-12) lists it. Days, activities,
 * budgets and transport costs are deliberately left out: open the itinerary
 * itself for those (ITN-21).
 */
export interface PublicItinerarySummary {
  id: string;
  /** The author (the itinerary's `ownerId`). */
  ownerId: string;
  title: string;
  /** → countries (by code). */
  countryCodes: string[];
  /** UTC calendar date, `DateOnly` (ITN-01). */
  startDate: Date;
  /** `days.length` (ITN-05). */
  dayCount: number;
  /** Distinct `days[].cityId`, in no particular order (ITN-09). */
  cityIds: string[];
  /** Sort key of the list (ITN-03). */
  updatedAt: Date;
}

/** Page options for the public itinerary list. Defaults: `page` 1, `limit` 10. */
export interface PublicItineraryQuery {
  /** 1-based. */
  page?: number;
  /** 1-50 (GEN-05). */
  limit?: number;
}
