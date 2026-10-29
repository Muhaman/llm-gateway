import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

export interface Metrics {
  registry: Registry;
  requestDuration: Histogram<"method" | "route" | "status">;
  tokens: Counter<"direction" | "model">;
  cacheHits: Counter;
  upstreamErrors: Counter<"status">;
}

/** One registry per app instance, so tests can build many apps without duplicate-registration errors. */
export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  return {
    registry,
    requestDuration: new Histogram({
      name: "gateway_request_duration_seconds",
      help: "HTTP request duration in seconds.",
      labelNames: ["method", "route", "status"],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
      registers: [registry],
    }),
    tokens: new Counter({
      name: "gateway_tokens_total",
      help: "Tokens processed, by direction and serving model.",
      labelNames: ["direction", "model"],
      registers: [registry],
    }),
    cacheHits: new Counter({
      name: "gateway_cache_hits_total",
      help: "Responses served from the Redis cache.",
      registers: [registry],
    }),
    upstreamErrors: new Counter({
      name: "gateway_upstream_errors_total",
      help: "Upstream failures by HTTP status (\"connection\" when none).",
      labelNames: ["status"],
      registers: [registry],
    }),
  };
}
