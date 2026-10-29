import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { createKey } from "../src/auth/keys.js";
import { FakeUpstream } from "./fakeUpstream.js";
import { openTestRedis, type TestRedis } from "./redis.js";

export interface Harness {
  app: Express;
  upstream: FakeUpstream;
  redis: TestRedis["redis"];
  cleanup: () => Promise<void>;
  newKey: (limits?: { rpm?: number; dailyTokens?: number }) => Promise<string>;
}

export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"];

export function buildHarness(upstream = new FakeUpstream()): Harness {
  const { redis, cleanup } = openTestRedis();
  const app = createApp({
    redis,
    upstream,
    models: MODELS,
    cacheTtlS: 60,
    corsOrigins: [],
    logger: createLogger("silent"),
  });
  return {
    app,
    upstream,
    redis,
    cleanup,
    newKey: (limits = {}) =>
      createKey(redis, { name: "test", rpm: limits.rpm ?? 100, dailyTokens: limits.dailyTokens ?? 1_000_000 }),
  };
}

export const REQUEST_BODY = {
  model: "claude-opus-5-5",
  max_tokens: 64,
  messages: [{ role: "user", content: "hello" }],
};
