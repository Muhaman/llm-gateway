import type { RequestHandler, Response } from "express";
import type { Redis } from "ioredis";
import { errorBody } from "../errors.js";
import { consume } from "../ratelimit/tokenBucket.js";
import { findKey, type ApiKeyRecord } from "./keys.js";

export const getApiKey = (res: Response): ApiKeyRecord => res.locals.apiKey as ApiKeyRecord;

/** Authenticates `x-api-key`, then applies that key's per-minute token bucket. */
export function requireApiKey(redis: Redis): RequestHandler {
  return async (req, res, next) => {
    const raw = req.header("x-api-key");
    const record = raw ? await findKey(redis, raw) : null;
    if (!record) {
      res.status(401).json(errorBody("unauthorized", "Missing or invalid x-api-key."));
      return;
    }
    const verdict = await consume(redis, `gw:rl:${record.hash}`, {
      capacity: record.rpm,
      refillPerSec: record.rpm / 60,
    });
    if (!verdict.allowed) {
      res.setHeader("retry-after", String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))));
      res.status(429).json(errorBody("rate_limited", "Request rate limit exceeded for this key."));
      return;
    }
    res.locals.apiKey = record;
    next();
  };
}
