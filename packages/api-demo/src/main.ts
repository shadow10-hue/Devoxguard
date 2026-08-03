import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { FakeAuthMiddleware } from './auth/fake-auth.middleware';

export async function createApp() {
  const app = await NestFactory.create(AppModule);
  const authMiddleware = new FakeAuthMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) => authMiddleware.use(req, res, next));
  return app;
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(process.env.PORT ?? 3000);
}

if (require.main === module) {
  bootstrap();
}
