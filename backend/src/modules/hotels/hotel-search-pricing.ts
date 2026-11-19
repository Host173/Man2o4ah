import type { RoomView } from './hotels.types.js';

/** HTL-12: price a room only if it can join a capacity-valid selection of roomCount rooms. */
export function cheapestQualifyingRoomPrice(
  freeRooms: readonly Pick<RoomView, 'maxOccupancy' | 'pricePerNightMinor'>[],
  guests: number,
  roomCount: number,
): number | null {
  const sorted = [...freeRooms].sort((a, b) => b.maxOccupancy - a.maxOccupancy);
  if (sorted.length < roomCount) return null;
  const capacity = sorted
    .slice(0, roomCount)
    .reduce((sum, room) => sum + room.maxOccupancy, 0);
  if (capacity < guests) return null;

  // The largest rooms already qualify; other rooms must fit beside the largest roomCount - 1.
  const companionCapacity = capacity - sorted[roomCount - 1].maxOccupancy;
  return sorted.reduce(
    (price, room, index) =>
      index < roomCount || room.maxOccupancy + companionCapacity >= guests
        ? Math.min(price, room.pricePerNightMinor)
        : price,
    Infinity,
  );
}
