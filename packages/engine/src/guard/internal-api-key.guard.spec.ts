import { ExecutionContext, HttpException, UnauthorizedException } from '@nestjs/common';
import { DevoxGuardConfig } from '../devoxguard-config';
import { InternalApiKeyGuard } from './internal-api-key.guard';
import { TokenBucket } from './rate-limiter/token-bucket';

function contextWithHeader(header: string | string[] | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-devoxguard-api-key': header } }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(capacity = 10) {
  const config = { apiKey: 'correct-key' } as DevoxGuardConfig;
  const limiter = new TokenBucket(capacity, 0);
  return { guard: new InternalApiKeyGuard(config, limiter), limiter };
}

describe('InternalApiKeyGuard', () => {
  it('allows a request with the correct key', () => {
    const { guard } = makeGuard();
    expect(guard.canActivate(contextWithHeader('correct-key'))).toBe(true);
  });

  it('rejects a missing key with 401', () => {
    const { guard } = makeGuard();
    expect(() => guard.canActivate(contextWithHeader(undefined))).toThrow(UnauthorizedException);
  });

  it('rejects a wrong key of a different length than the real key with 401, not a length-mismatch crash', () => {
    const { guard } = makeGuard();
    expect(() => guard.canActivate(contextWithHeader('x'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWithHeader('a-much-longer-wrong-key-value'))).toThrow(
      UnauthorizedException,
    );
  });

  it('takes only the first value of a repeated header', () => {
    const { guard } = makeGuard();
    expect(guard.canActivate(contextWithHeader(['correct-key', 'other']))).toBe(true);
  });

  it('throws 429 once the auth rate limiter is exhausted by failed attempts', () => {
    const { guard } = makeGuard(3);
    for (let i = 0; i < 3; i++) {
      expect(() => guard.canActivate(contextWithHeader('wrong'))).toThrow(UnauthorizedException);
    }
    expect(() => guard.canActivate(contextWithHeader('wrong'))).toThrow(HttpException);
    try {
      guard.canActivate(contextWithHeader('wrong'));
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(429);
    }
  });

  it('does not consume the rate limiter on successful requests, so a correct key still works after failures', () => {
    const { guard, limiter } = makeGuard(2);
    expect(() => guard.canActivate(contextWithHeader('wrong'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWithHeader('wrong'))).toThrow(UnauthorizedException);
    // Bucket of capacity 2 is now exhausted by the two failures above, but a
    // correct key must still succeed regardless of the limiter's state.
    expect(guard.canActivate(contextWithHeader('correct-key'))).toBe(true);
    expect(limiter.tryConsume(1)).toBe(false); // confirms the bucket really was left exhausted
  });
});
