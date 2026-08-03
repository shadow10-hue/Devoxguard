import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module';
import { ReviewsModule } from './reviews/reviews.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [OrdersModule, UsersModule, ReviewsModule],
})
export class AppModule {}
