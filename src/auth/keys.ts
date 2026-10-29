import { createHash, randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import { z } from "zod";

export interface KeyLimits {
  name: string;
  rpm: number;
  dailyTokens: number;
}

export interface ApiKeyRecord extends KeyLimits {
  hash: string;
}

const limitsSchema = z.object({
  name: z.string().min(1),
  rpm: z.coerce.number().int().positive(),
  dailyTokens: z.coerce.number().int().positive(),
});

export const hashKey = (raw: string): string => createHash("sha256").update(raw).digest("hex");
const redisKey = (hash: string) => `gw:key:${hash}`;

/** Stores only the sha256 of the key; the raw `gw_<32 hex>` value is returned once and never persisted. */
export async function createKey(redis: Redis, limits: KeyLimits): Promise<string> {
  const parsed = limitsSchema.parse(limits);
  const raw = `gw_${randomBytes(16).toString("hex")}`;
  await redis.hset(redisKey(hashKey(raw)), {
    name: parsed.name,
    rpm: String(parsed.rpm),
    dailyTokens: String(parsed.dailyTokens),
  });
  return raw;
}

export async function findKey(redis: Redis, raw: string): Promise<ApiKeyRecord | null> {
  const hash = hashKey(raw);
  const fields = await redis.hgetall(redisKey(hash));
  const parsed = limitsSchema.safeParse(fields);
  return parsed.success ? { hash, ...parsed.data } : null;
}
