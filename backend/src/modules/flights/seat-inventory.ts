import { Injectable, NotImplementedException } from '@nestjs/common';
import type { InventoryOptions, SeatItem } from './flights.types.js';

/**
 * The only code that changes seat counters (data-model 4.1). Every method takes
 * the caller's transaction and runs inside it; one that cannot apply its change
 * throws, which aborts the whole transaction. Each item is one atomic update
 * (`$elemMatch` + positional `$`), so check and change can't be separated.
 * Implemented in INV-01.
 */
@Injectable()
export class SeatInventory {
  /**
   * Take the seats of every item only if each cabin has them: `availableSeats` down,
   * `heldSeats` up, `hasBookings = true`. The flight must be `scheduled` and in the future.
   * Throws 409 `SEATS_UNAVAILABLE`.
   */
  hold(items: SeatItem[], options: InventoryOptions): Promise<void> {
    void items;
    void options;
    throw new NotImplementedException('hold: implemented in INV-01');
  }

  /** Held seats become booked. Throws 500 `INVENTORY_CORRUPTED` if fewer are held. */
  confirm(items: SeatItem[], options: InventoryOptions): Promise<void> {
    void items;
    void options;
    throw new NotImplementedException('confirm: implemented in INV-01');
  }

  /** Held seats become available again (hold expired or payment failed). Throws 500 `INVENTORY_CORRUPTED`. */
  release(items: SeatItem[], options: InventoryOptions): Promise<void> {
    void items;
    void options;
    throw new NotImplementedException('release: implemented in INV-01');
  }

  /** Booked seats become available again (cancellation). Throws 500 `INVENTORY_CORRUPTED`. */
  returnBooked(items: SeatItem[], options: InventoryOptions): Promise<void> {
    void items;
    void options;
    throw new NotImplementedException('returnBooked: implemented in INV-01');
  }

  /**
   * Change a cabin's capacity from `expectedTotal` to `newTotal` (FLT-05). The caller passes the
   * total it saw, so a parallel change is detected. Throws 409 `CONCURRENT_CHANGE` if the total
   * is no longer `expectedTotal`, 409 `CAPACITY_BELOW_RESERVED` if held + booked seats exceed `newTotal`.
   */
  changeCapacity(
    flightId: string,
    cabinId: string,
    newTotal: number,
    expectedTotal: number,
    options: InventoryOptions,
  ): Promise<void> {
    void flightId;
    void cabinId;
    void newTotal;
    void expectedTotal;
    void options;
    throw new NotImplementedException('changeCapacity: implemented in INV-01');
  }
}
