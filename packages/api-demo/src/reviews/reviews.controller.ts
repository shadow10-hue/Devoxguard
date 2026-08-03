import { Body, Controller, Get, Post } from '@nestjs/common';
import { SeedReview } from '../seed/seed-data';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  list() {
    return this.reviewsService.list();
  }

  @Post()
  create(@Body() body: Omit<SeedReview, 'id'>) {
    return this.reviewsService.create(body);
  }
}
