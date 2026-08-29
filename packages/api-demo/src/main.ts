import { env } from './config/env'; // validated first: must run before AppModule reads process.env
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import { NextFunction, Request, Response, json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { FakeAuthMiddleware } from './auth/fake-auth.middleware';

// Defense in depth: the DevoxGuard engine is the primary control, but the app
// also hardens its own boundary so a single missed detection isn't a single
// point of failure. The deliberately-vulnerable endpoints (IDOR, mass
// assignment, injection — see .github/SECURITY.md AR-1..AR-9) stay exploitable
// by design; these measures apply to everything else and to future endpoints.
const MAX_BODY_SIZE = '100kb';

export async function createApp() {
  // bodyParser: false so the size-limited parsers below fully replace Nest's
  // defaults, instead of running in addition to them.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Reject oversized payloads before any handler or the engine sees them.
  app.use(json({ limit: MAX_BODY_SIZE }));
  app.use(urlencoded({ extended: true, limit: MAX_BODY_SIZE }));

  // Baseline security headers. CSP is disabled here (this is a JSON API with
  // no first-party HTML; the dashboard's own CSP is set in its nginx config),
  // leaving helmet's transport/framing/sniffing protections in place.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Don't advertise the framework (ZAP 10037), and keep API responses out
  // of shared caches — they carry per-user and security-finding data
  // (ZAP 10049).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.removeHeader('X-Powered-By');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // gzip/deflate response bodies. Safe alongside Cache-Control: no-store
  // above (compression only affects Content-Encoding, not caching), and
  // none of this app's endpoints reflect request-controlled input back
  // into a response body, so this isn't exposed to BREACH-style
  // compression-oracle attacks — re-check this note if that ever changes.
  // threshold: 0 (default is 1kb) — this app's JSON responses are mostly
  // small, so the default would rarely fire; gzip's own ~20-30 byte
  // frame overhead is negligible next to the bandwidth saved even on
  // modest payloads.
  app.use(compression({ threshold: 0 }));
  app.enableCors({
    origin: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-devoxguard-api-key'],
  });
  const authMiddleware = new FakeAuthMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) =>
    authMiddleware.use(req, res, next),
  );
  // Strips unknown properties and rejects payloads that carry them, for any
  // endpoint whose body/query is typed with a validated DTO. Inert on the
  // demo's deliberately-vulnerable endpoints (they take raw
  // Record<string, unknown>, which the pipe does not validate), so it hardens
  // future endpoints without neutering the intentional flaws.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Runs onModuleDestroy/onApplicationShutdown (see the engine's storage
  // shutdown provider) on SIGTERM/SIGINT, then terminates the process
  // itself — no separate process.on(SIGTERM) handler needed here, and
  // adding one that also called app.close() would race Nest's own
  // shutdown sequence rather than complement it.
  app.enableShutdownHooks();
  return app;
}

export async function bootstrap() {
  const logger = new Logger('Bootstrap');
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () =>
      logger.log(`Received ${signal}, shutting down gracefully`),
    );
  }
  const app = await createApp();
  await app.listen(env.PORT);
}

if (require.main === module) {
  void bootstrap();
}
