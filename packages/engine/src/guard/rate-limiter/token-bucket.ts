export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillRatePerSec: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.lastRefill = this.now();
  }

  /** Returns false if there aren't enough tokens to cover `cost`. */
  tryConsume(cost = 1): boolean {
    this.refill();
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  /** Called by the anomaly engine to dynamically harden the bucket (e.g. factor 0.5 halves capacity). */
  reduceCapacity(factor: number): void {
    this.refill();
    this.capacity *= factor;
    this.tokens = Math.min(this.tokens, this.capacity);
  }

  private refill(): void {
    const now = this.now();
    const elapsedSec = Math.max(0, (now - this.lastRefill) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillRatePerSec);
    this.lastRefill = now;
  }
}
