import { afterAll, describe, expect, it } from "vitest";
import { consume } from "../src/ratelimit/tokenBucket.js";
import { openTestRedis } from "./redis.js";

const { redis, cleanup } = openTestRedis();
afterAll(cleanup);

describe("consume", () => {
  it("denies the third immediate call on a capacity-2 bucket and reports a retry delay", async () => {
    const params = { capacity: 2, refillPerSec: 10 };
    expect((await consume(redis, "bucket:a", params)).allowed).toBe(true);
    const second = await consume(redis, "bucket:a", params);
    expect(second.allowed).toBe(true);
    const third = await consume(redis, "bucket:a", params);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it("allows again once the refill window has passed", async () => {
    const params = { capacity: 1, refillPerSec: 10 };
    await consume(redis, "bucket:b", params);
    const denied = await consume(redis, "bucket:b", params);
    expect(denied.allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, denied.retryAfterMs + 50));
    expect((await consume(redis, "bucket:b", params)).allowed).toBe(true);
  });

  it("charges a custom cost and never over-admits under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consume(redis, "bucket:c", { capacity: 5, refillPerSec: 0.001 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    const heavy = await consume(redis, "bucket:d", { capacity: 5, refillPerSec: 0.001, cost: 5 });
    expect(heavy).toMatchObject({ allowed: true, remaining: 0 });
  });
});
