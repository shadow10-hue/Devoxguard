import { ReviewsService } from './reviews.service';

describe('ReviewsService', () => {
  it('list returns the seeded reviews', () => {
    const service = new ReviewsService();
    expect(service.list().length).toBeGreaterThan(0);
  });

  it('create appends a new review and assigns it an id', () => {
    const service = new ReviewsService();
    const before = service.list().length;

    const created = service.create({ orderId: '2', userId: '1', rating: 4, comment: 'Good' });

    expect(created.id).toBeDefined();
    expect(service.list().length).toBe(before + 1);
  });
});
