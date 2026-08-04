import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { FakeAuthMiddleware } from './auth/fake-auth.middleware';

export async function createApp() {
  const app = await NestFactory.create(AppModule);
  // Don't advertise the framework (ZAP 10037), and keep API responses out
  // of shared caches — they carry per-user and security-finding data
  // (ZAP 10049).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.removeHeader('X-Powered-By');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({
    origin: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-devoxguard-api-key'],
  });
  const authMiddleware = new FakeAuthMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) =>
    authMiddleware.use(req, res, next),
  );
  return app;
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(process.env.PORT ?? 3000);
}

if (require.main === module) {
  bootstrap();
}
