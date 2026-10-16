export type RetryPolicy = {
  maximumAttempts: number;
  baseDelayMs: number;
  maximumDelayMs: number;
  retryableCodes: readonly string[];
};

export function retryDelay(policy: RetryPolicy, attempt: number): number {
  if (attempt < 1) throw new Error("attempt must be positive");
  return Math.min(policy.maximumDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
}

export function shouldRetry(policy: RetryPolicy, attempt: number, errorCode: string): boolean {
  return attempt < policy.maximumAttempts && policy.retryableCodes.includes(errorCode);
}

export class IdempotencyRegistry<T> {
  #results = new Map<string, T>();

  async execute(key: string, operation: () => Promise<T>): Promise<{ replayed: boolean; value: T }> {
    if (!key.trim()) throw new Error("idempotency key is required");
    const existing = this.#results.get(key);
    if (existing !== undefined) return { replayed: true, value: structuredClone(existing) };
    const value = await operation();
    this.#results.set(key, structuredClone(value));
    return { replayed: false, value };
  }
}

export class CircuitBreaker {
  #failures = 0;
  #openedAt: number | null = null;
  private readonly threshold: number;
  private readonly resetAfterMs: number;

  constructor(threshold: number, resetAfterMs: number) {
    if (threshold < 1 || resetAfterMs < 1) throw new Error("invalid circuit-breaker configuration");
    this.threshold = threshold;
    this.resetAfterMs = resetAfterMs;
  }

  canRun(now: number): boolean {
    if (this.#openedAt === null) return true;
    if (now - this.#openedAt >= this.resetAfterMs) {
      this.#openedAt = null;
      this.#failures = 0;
      return true;
    }
    return false;
  }

  success(): void {
    this.#failures = 0;
    this.#openedAt = null;
  }

  failure(now: number): void {
    this.#failures += 1;
    if (this.#failures >= this.threshold) this.#openedAt = now;
  }

  get state(): "closed" | "open" {
    return this.#openedAt === null ? "closed" : "open";
  }
}
