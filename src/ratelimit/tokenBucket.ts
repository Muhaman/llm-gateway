import { readFileSync } from "node:fs";
import type { Redis } from "ioredis";

const LUA = readFileSync(new URL("./tokenBucket.lua", import.meta.url), "utf8");

interface BucketCommand {
  gwTokenBucket(key: string, capacity: number, refillPerSec: number, cost: number): Promise<[number, string, number]>;
}

const registered = new WeakSet<Redis>();

export interface BucketParams {
  capacity: number;
  refillPerSec: number;
  cost?: number;
}

export interface BucketResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/** Atomic token bucket: one Lua script, timestamps from Redis TIME so app clocks never matter. */
export async function consume(redis: Redis, bucketKey: string, p: BucketParams): Promise<BucketResult> {
  const cost = p.cost ?? 1;
  if (!(p.capacity > 0 && p.refillPerSec > 0 && cost > 0)) {
    throw new RangeError("capacity, refillPerSec and cost must be positive");
  }
  if (!registered.has(redis)) {
    redis.defineCommand("gwTokenBucket", { numberOfKeys: 1, lua: LUA });
    registered.add(redis);
  }
  const [allowed, remaining, retryAfterMs] = await (redis as Redis & BucketCommand).gwTokenBucket(
    bucketKey,
    p.capacity,
    p.refillPerSec,
    cost,
  );
  return { allowed: allowed === 1, remaining: Math.floor(Number(remaining)), retryAfterMs: Number(retryAfterMs) };
}
