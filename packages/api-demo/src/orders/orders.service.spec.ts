import { NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(() => {
    service = new OrdersService();
  });

  it('listForUser returns only orders owned by the given user', () => {
    expect(service.listForUser('1')).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: '1' })]),
    );
    expect(service.listForUser('1').every((o) => o.userId === '1')).toBe(true);
  });

  it('listForUser returns an empty array when no userId is given', () => {
    expect(service.listForUser(undefined)).toEqual([]);
  });

  it('findById returns the order regardless of caller (deliberate IDOR)', () => {
    const order = service.findById('3');
    expect(order.userId).toBe('2');
  });

  it('findById throws NotFoundException for an unknown id', () => {
    expect(() => service.findById('does-not-exist')).toThrow(NotFoundException);
  });
});
