import { TokenBucket } from './token-bucket';

function manualClock(startMs = 0) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('TokenBucket', () => {
  it('starts full: capacity tokens are immediately consumable', () => {
    const clock = manualClock();
    const bucket = new TokenBucket(3, 1, clock.now);

    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
  });

  it('tryConsume exhaustion: returns false once tokens run out', () => {
    const clock = manualClock();
    const bucket = new TokenBucket(3, 0, clock.now); // no refill

    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it('refills over time at refillRatePerSec, capped at capacity', () => {
    const clock = manualClock();
    const bucket = new TokenBucket(10, 1, clock.now); // 1 token/sec

    for (let i = 0; i < 10; i += 1) bucket.tryConsume();
    expect(bucket.tryConsume()).toBe(false);

    clock.advance(5_000); // 5s -> 5 tokens refilled
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);

    clock.advance(100_000); // way more than enough time to refill to capacity
    expect(bucket.tryConsume(10)).toBe(true); // capped at capacity=10, not unbounded
    expect(bucket.tryConsume()).toBe(false);
  });

  it('reduceCapacity shrinks capacity and clamps current tokens to the new cap', () => {
    const clock = manualClock();
    const bucket = new TokenBucket(10, 0, clock.now);

    bucket.reduceCapacity(0.5); // capacity 10 -> 5, tokens clamped from 10 to 5
    expect(bucket.tryConsume(6)).toBe(false);
    expect(bucket.tryConsume(5)).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });
});
