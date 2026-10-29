import { Router } from "express";
import type { Redis } from "ioredis";
import type { Metrics } from "../metrics.js";

export function healthRouter(redis: Redis, metrics: Metrics): Router {
  const router = Router();

  router.get("/healthz", async (_req, res) => {
    try {
      await redis.ping();
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ error: { code: "redis_unavailable", message: "Redis is unreachable." } });
    }
  });

  router.get("/metrics", async (_req, res) => {
    res.setHeader("content-type", metrics.registry.contentType);
    res.send(await metrics.registry.metrics());
  });

  return router;
}
