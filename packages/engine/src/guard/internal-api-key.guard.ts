import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { DEVOXGUARD_CONFIG, DevoxGuardConfig } from '../devoxguard-config';
import { RateLimiter } from './devoxguard.guard';

const API_KEY_HEADER = 'x-devoxguard-api-key';

/** DI token for the InternalApiKeyGuard's dedicated brute-force limiter — a separate TokenBucket instance from the one used by the anomaly-detection decision pipeline (different concern, must not share state). */
export const DEVOXGUARD_AUTH_RATE_LIMITER = 'DEVOXGUARD_AUTH_RATE_LIMITER';

/**
 * Minimal auth for the internal dashboard endpoints (spec section 6):
 * a static API key checked against a header. Proportionate to a
 * stage/demo project — not meant to be a general-purpose auth system.
 *
 * The comparison is constant-time (AR-7): both sides are hashed to a
 * fixed-length digest before timingSafeEqual, since the raw header can be
 * any length and timingSafeEqual throws on a length mismatch. Repeated
 * failed attempts are throttled by a dedicated rate limiter — a bucket
 * shared across all callers, not per-IP, so a sustained attacker can also
 * throttle a legitimate operator during an attack; accepted for a
 * single-static-key model on a trusted internal network.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiKeyGuard.name);
  private readonly expectedDigest: Buffer;

  constructor(
    @Inject(DEVOXGUARD_CONFIG) private readonly config: DevoxGuardConfig,
    @Inject(DEVOXGUARD_AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter,
  ) {
    this.expectedDigest = createHash('sha256').update(this.config.apiKey).digest();
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const rawHeader = req.headers[API_KEY_HEADER];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (provided && this.matchesKey(provided)) {
      return true;
    }

    if (!this.rateLimiter.tryConsume(1)) {
      this.logger.warn('Internal API key rate limit exceeded — possible brute-force attempt');
      throw new HttpException('Too many attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
    throw new UnauthorizedException('Missing or invalid x-devoxguard-api-key header');
  }

  private matchesKey(supplied: string): boolean {
    const suppliedDigest = createHash('sha256').update(supplied).digest();
    return timingSafeEqual(suppliedDigest, this.expectedDigest);
  }
}
