import { Module } from '@nestjs/common';
import { DevoxGuardModule } from '@devox/engine';
import * as path from 'path';
import { env } from './config/env';
import { AccountsModule } from './accounts/accounts.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { ReviewsModule } from './reviews/reviews.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    OrdersModule,
    UsersModule,
    ReviewsModule,
    ProductsModule,
    AccountsModule,
    DevoxGuardModule.forRoot({
      mongoUri: env.DEVOXGUARD_MONGO_URI,
      mongoDbName: env.DEVOXGUARD_MONGO_DB,
      elasticsearchNode: env.DEVOXGUARD_ES_NODE,
      redisUrl: env.DEVOXGUARD_REDIS_URI,
      apiKey: env.DEVOXGUARD_API_KEY,
      rulesDirectory: path.join(
        require.resolve('@devox/engine'),
        '..',
        'rules',
        'default-rules',
      ),
      tokenBucket: { capacity: 20, refillRatePerSec: 2 },
      authRateLimiter: { capacity: 10, refillRatePerSec: 0.2 },
      // Automated incident response (docs/incident-response.md). Inert unless
      // the corresponding env vars are set: no webhook → no alerting; flag
      // off → no IP containment.
      alerting: { webhookUrl: env.DEVOXGUARD_ALERT_WEBHOOK },
      autoContainment: { enabled: env.DEVOXGUARD_AUTO_CONTAIN },
    }),
  ],
})
export class AppModule {}
