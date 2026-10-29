import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type Express } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import type { Redis } from "ioredis";
import { requireApiKey } from "./auth/middleware.js";
import { errorBody, errorHandler } from "./errors.js";
import type { Logger } from "./logger.js";
import { createMetrics } from "./metrics.js";
import { healthRouter } from "./routes/health.js";
import { messagesRouter } from "./routes/messages.js";
import { usageRouter } from "./routes/usage.js";
import type { Upstream } from "./upstream.js";

export interface AppDeps {
  redis: Redis;
  upstream: Upstream;
  models: readonly string[];
  cacheTtlS: number;
  corsOrigins: string[];
  logger: Logger;
  /** Per-IP requests per minute, a coarse guard in front of key lookups; defaults to 600. */
  ipRateLimitPerMinute?: number;
}

export function createApp(deps: AppDeps): Express {
  const metrics = createMetrics();
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const incoming = req.header("x-request-id");
    const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
    res.setHeader("x-request-id", requestId);
    const end = metrics.requestDuration.startTimer();
    res.on("finish", () => {
      const route = req.route ? `${req.baseUrl}${req.route.path === "/" ? "" : req.route.path}` : "unmatched";
      const seconds = end({ method: req.method, route, status: res.statusCode });
      deps.logger.info(
        { requestId, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(seconds * 1000) },
        "request",
      );
    });
    next();
  });

  app.use(helmet());
  app.use(cors({ origin: deps.corsOrigins }));

  app.use(healthRouter(deps.redis, metrics));

  app.use(
    "/v1",
    rateLimit({
      windowMs: 60_000,
      limit: deps.ipRateLimitPerMinute ?? 600,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json(errorBody("rate_limited", "Too many requests."));
      },
    }),
    requireApiKey(deps.redis),
  );
  app.use(
    "/v1/messages",
    messagesRouter({
      redis: deps.redis,
      upstream: deps.upstream,
      models: deps.models,
      cacheTtlS: deps.cacheTtlS,
      metrics,
      logger: deps.logger,
    }),
  );
  app.use("/v1/usage", usageRouter(deps.redis));

  app.use((_req, res) => {
    res.status(404).json(errorBody("not_found", "Route not found."));
  });
  app.use(errorHandler(deps.logger));
  return app;
}
