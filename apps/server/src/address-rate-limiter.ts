interface RateWindow {
  startedAt: number;
  count: number;
  windowMs: number;
}

/** A bounded, process-local limiter keyed only by the socket's transport peer address. */
export class AddressRateLimiter {
  private readonly windows = new Map<string, RateWindow>();

  constructor(private readonly maximumEntries = 10_000) {}

  allow(
    address: string,
    event: string,
    maximum: number,
    windowMs: number,
    now = Date.now(),
  ): boolean {
    const key = `${address}\u0000${event}`;
    const current = this.windows.get(key);
    if (current && now - current.startedAt < current.windowMs) {
      if (current.count >= maximum) return false;
      current.count += 1;
      return true;
    }

    if (!current && this.windows.size >= this.maximumEntries) this.removeExpired(now);
    if (!current && this.windows.size >= this.maximumEntries) return false;

    this.windows.set(key, { startedAt: now, count: 1, windowMs });
    return true;
  }

  private removeExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= window.windowMs) this.windows.delete(key);
    }
  }
}
