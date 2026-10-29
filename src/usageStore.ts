import type { Redis } from "ioredis";
import type { Usage } from "./cost.js";
import type { StreamEvent } from "./upstream.js";

const RETENTION_SECONDS = 40 * 24 * 3600;
const usageKey = (keyHash: string, date: string) => `gw:usage:${keyHash}:${date}`;

export const utcDate = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function toUsage(raw: unknown): Usage {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    input_tokens: count(r.input_tokens),
    output_tokens: count(r.output_tokens),
    cache_read_input_tokens: count(r.cache_read_input_tokens),
  };
}

/** Accumulates token usage from Anthropic stream events (message_start, then cumulative message_delta). */
export class StreamUsage {
  private usage: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };

  observe(event: StreamEvent): void {
    if (event.type === "message_start") {
      this.usage = toUsage((event as { message?: { usage?: unknown } }).message?.usage);
    } else if (event.type === "message_delta") {
      const delta = toUsage((event as { usage?: unknown }).usage);
      this.usage = { ...this.usage, output_tokens: delta.output_tokens || this.usage.output_tokens };
    }
  }

  get total(): Usage {
    return this.usage;
  }
}

export interface UsageDelta {
  input: number;
  output: number;
  costMicroUsd: number;
}

export async function recordUsage(redis: Redis, keyHash: string, delta: UsageDelta): Promise<void> {
  const key = usageKey(keyHash, utcDate());
  await redis
    .multi()
    .hincrby(key, "input", delta.input)
    .hincrby(key, "output", delta.output)
    .hincrbyfloat(key, "costMicroUsd", delta.costMicroUsd)
    .hincrby(key, "requests", 1)
    .expire(key, RETENTION_SECONDS)
    .exec();
}

export interface DayUsage {
  date: string;
  input: number;
  output: number;
  costMicroUsd: number;
  requests: number;
}

const parseDay = (date: string, h: Record<string, string>): DayUsage => ({
  date,
  input: Number(h.input ?? 0),
  output: Number(h.output ?? 0),
  costMicroUsd: Number(h.costMicroUsd ?? 0),
  requests: Number(h.requests ?? 0),
});

export async function tokensUsedToday(redis: Redis, keyHash: string): Promise<number> {
  const [input, output] = await redis.hmget(usageKey(keyHash, utcDate()), "input", "output");
  return Number(input ?? 0) + Number(output ?? 0);
}

/** Most recent `days` UTC days, newest first. */
export async function usageForDays(redis: Redis, keyHash: string, days: number): Promise<DayUsage[]> {
  const dates = Array.from({ length: days }, (_, i) => utcDate(new Date(Date.now() - i * 86_400_000)));
  const pipeline = redis.pipeline();
  for (const date of dates) pipeline.hgetall(usageKey(keyHash, date));
  const results = (await pipeline.exec()) ?? [];
  return dates.map((date, i) => parseDay(date, (results[i]?.[1] ?? {}) as Record<string, string>));
}

export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}
