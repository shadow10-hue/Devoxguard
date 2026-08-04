import { Module } from '@nestjs/common';
import { DevoxGuardModule } from '@devox/engine';
import * as path from 'path';
import { OrdersModule } from './orders/orders.module';
import { ReviewsModule } from './reviews/reviews.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    OrdersModule,
    UsersModule,
    ReviewsModule,
    DevoxGuardModule.forRoot({
      mongoUri: process.env.DEVOXGUARD_MONGO_URI ?? 'mongodb://localhost:27017',
      mongoDbName: process.env.DEVOXGUARD_MONGO_DB ?? 'devoxguard',
      elasticsearchNode:
        process.env.DEVOXGUARD_ES_NODE ?? 'http://localhost:9200',
      apiKey: process.env.DEVOXGUARD_API_KEY ?? 'dev-api-key',
      rulesDirectory: path.join(
        require.resolve('@devox/engine'),
        '..',
        'rules',
        'default-rules',
      ),
      tokenBucket: { capacity: 20, refillRatePerSec: 2 },
    }),
  ],
})
export class AppModule {}
