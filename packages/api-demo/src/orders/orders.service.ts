import { Injectable, NotFoundException } from '@nestjs/common';
import { ORDERS, SeedOrder } from '../seed/seed-data';

@Injectable()
export class OrdersService {
  listForUser(userId: string | undefined): SeedOrder[] {
    if (!userId) return [];
    return ORDERS.filter((order) => order.userId === userId);
  }

  /**
   * Deliberately vulnerable: returns any order by id with no ownership
   * check against the caller. This is the IDOR flaw DevoxGuard's
   * idor-orders rule is meant to catch.
   */
  findById(id: string): SeedOrder {
    const order = ORDERS.find((o) => o.id === id);
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }
}
