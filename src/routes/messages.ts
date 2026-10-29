import express, { Router } from "express";
import type { Redis } from "ioredis";
import { getApiKey } from "../auth/middleware.js";
import { cacheKey } from "../cache/key.js";
import { getCached, putCached } from "../cache/store.js";
import { costUsd, type Usage } from "../cost.js";
import { AppError, errorBody } from "../errors.js";
import type { Logger } from "../logger.js";
import type { Metrics } from "../metrics.js";
import {
  callUpstream,
  messagesBodySchema,
  UpstreamHttpError,
  type MessageResponse,
  type Upstream,
  type UpstreamResult,
} from "../upstream.js";
import { recordUsage, secondsUntilUtcMidnight, StreamUsage, toUsage, tokensUsedToday } from "../usageStore.js";

export interface MessagesDeps {
  redis: Redis;
  upstream: Upstream;
  models: readonly string[];
  cacheTtlS: number;
  metrics: Metrics;
  logger: Logger;
}

export function messagesRouter(deps: MessagesDeps): Router {
  const { redis, upstream, models, cacheTtlS, metrics, logger } = deps;
  const router = Router();

  async function account(keyHash: string, model: string, usage: Usage): Promise<void> {
    const costMicroUsd = costUsd(model, usage, logger) * 1_000_000;
    metrics.tokens.inc({ direction: "input", model }, usage.input_tokens);
    metrics.tokens.inc({ direction: "output", model }, usage.output_tokens);
    await recordUsage(redis, keyHash, { input: usage.input_tokens, output: usage.output_tokens, costMicroUsd });
  }

  router.post("/", express.json({ limit: "5mb" }), async (req, res) => {
    const apiKey = getApiKey(res);
    const body = messagesBodySchema.parse(req.body);
    if (!models.includes(body.model)) {
      throw new AppError(400, "model_not_allowed", `Model "${body.model}" is not enabled on this gateway.`);
    }

    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });

    const streaming = body.stream === true;
    const key = cacheKey(body);

    if (!streaming) {
      const hit = await getCached(redis, apiKey.hash, key);
      if (hit) {
        metrics.cacheHits.inc();
        await recordUsage(redis, apiKey.hash, { input: 0, output: 0, costMicroUsd: 0 });
        res.setHeader("x-gateway-cache", "HIT").setHeader("x-gateway-model", hit.model).json(hit.response);
        return;
      }
    }

    if ((await tokensUsedToday(redis, apiKey.hash)) >= apiKey.dailyTokens) {
      res.setHeader("retry-after", String(secondsUntilUtcMidnight()));
      res.status(429).json(errorBody("daily_tokens_exceeded", "Daily token budget for this key is spent."));
      return;
    }

    let result: UpstreamResult;
    try {
      result = await callUpstream(upstream, body, models, abort.signal, (status) =>
        metrics.upstreamErrors.inc({ status }),
      );
    } catch (err) {
      if (abort.signal.aborted) return;
      if (err instanceof UpstreamHttpError) {
        res.status(err.status ?? 502).json(err.body ?? errorBody("upstream_error", err.message));
        return;
      }
      throw err;
    }

    res.setHeader("x-gateway-cache", "MISS").setHeader("x-gateway-model", result.model);

    if ("response" in result) {
      const response: MessageResponse = result.response;
      await account(apiKey.hash, result.model, toUsage((response as { usage?: unknown }).usage));
      if ((response as { stop_reason?: unknown }).stop_reason !== "refusal") {
        await putCached(redis, apiKey.hash, key, { model: result.model, response }, cacheTtlS);
      }
      res.json(response);
      return;
    }

    res.status(200);
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders();

    const usage = new StreamUsage();
    try {
      for await (const event of result.stream) {
        usage.observe(event);
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        logger.error({ err, model: result.model }, "upstream stream failed mid-response");
        const message = { type: "error", error: { type: "api_error", message: "Upstream stream interrupted." } };
        res.write(`event: error\ndata: ${JSON.stringify(message)}\n\n`);
      }
    } finally {
      await account(apiKey.hash, result.model, usage.total);
      res.end();
    }
  });

  return router;
}
