import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AddressRateLimiter } from "../src/address-rate-limiter.js";

describe("bounded address rate limiter", () => {
  it("shares a window across connections and resets after the window expires", () => {
    const limiter = new AddressRateLimiter();
    assert.equal(limiter.allow("127.0.0.1", "join", 2, 1_000, 100), true);
    assert.equal(limiter.allow("127.0.0.1", "join", 2, 1_000, 200), true);
    assert.equal(limiter.allow("127.0.0.1", "join", 2, 1_000, 300), false);
    assert.equal(limiter.allow("127.0.0.1", "join", 2, 1_000, 1_100), true);
  });

  it("fails closed when its bounded address table is full", () => {
    const limiter = new AddressRateLimiter(1);
    assert.equal(limiter.allow("one", "join", 1, 10_000, 0), true);
    assert.equal(limiter.allow("two", "join", 1, 10_000, 1), false);
    assert.equal(limiter.allow("two", "join", 1, 10_000, 10_000), true);
  });
});
