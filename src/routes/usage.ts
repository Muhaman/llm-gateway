import { Router } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";
import { getApiKey } from "../auth/middleware.js";
import { usageForDays, type DayUsage } from "../usageStore.js";

const querySchema = z.object({ days: z.coerce.number().int().min(1).max(31).default(7) });

const present = (d: DayUsage) => ({ ...d, costUsd: d.costMicroUsd / 1_000_000 });

export function usageRouter(redis: Redis): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    const { days } = querySchema.parse(req.query);
    const perDay = await usageForDays(redis, getApiKey(res).hash, days);
    const total = perDay.reduce(
      (acc, d) => ({
        input: acc.input + d.input,
        output: acc.output + d.output,
        costMicroUsd: acc.costMicroUsd + d.costMicroUsd,
        requests: acc.requests + d.requests,
      }),
      { input: 0, output: 0, costMicroUsd: 0, requests: 0 },
    );
    res.json({ days: perDay.map(present), total: { ...total, costUsd: total.costMicroUsd / 1_000_000 } });
  });
  return router;
}
