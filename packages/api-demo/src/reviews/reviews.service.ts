import { Injectable } from '@nestjs/common';
import { REVIEWS, SeedReview } from '../seed/seed-data';

@Injectable()
export class ReviewsService {
  list(): SeedReview[] {
    return REVIEWS;
  }

  create(review: Omit<SeedReview, 'id'>): SeedReview {
    const created: SeedReview = { id: String(REVIEWS.length + 1), ...review };
    REVIEWS.push(created);
    return created;
  }
}
