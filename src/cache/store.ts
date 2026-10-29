import type { Redis } from "ioredis";
import type { MessageResponse } from "../upstream.js";

export interface CachedEntry {
  model: string;
  response: MessageResponse;
}

/** Entries are scoped per api key so one tenant can never read another's completions. */
const entryKey = (keyHash: string, cacheKey: string) => `gw:cache:${keyHash}:${cacheKey}`;

export async function getCached(redis: Redis, keyHash: string, cacheKey: string): Promise<CachedEntry | null> {
  const raw = await redis.get(entryKey(keyHash, cacheKey));
  return raw ? (JSON.parse(raw) as CachedEntry) : null;
}

export async function putCached(
  redis: Redis,
  keyHash: string,
  cacheKey: string,
  entry: CachedEntry,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(entryKey(keyHash, cacheKey), JSON.stringify(entry), "EX", ttlSeconds);
}
