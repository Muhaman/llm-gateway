import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

export interface TestRedis {
  redis: Redis;
  cleanup: () => Promise<void>;
}

/** Connects with a unique key prefix so tests never touch each other's keys or flush the DB. */
export function openTestRedis(): TestRedis {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const prefix = `gwtest:${randomUUID()}:`;
  const redis = new Redis(url, { keyPrefix: prefix });
  const admin = new Redis(url);
  return {
    redis,
    cleanup: async () => {
      for await (const keys of admin.scanStream({ match: `${prefix}*`, count: 100 })) {
        if ((keys as string[]).length > 0) await admin.del(...(keys as string[]));
      }
      redis.disconnect();
      admin.disconnect();
    },
  };
}
