import { config } from "dotenv";
import { Redis } from "ioredis";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { AnthropicUpstream } from "./upstream.js";

config({ quiet: true });

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const redis = new Redis(env.REDIS_URL);
redis.on("error", (err) => logger.error({ err }, "redis error"));

const app = createApp({
  redis,
  upstream: new AnthropicUpstream(env.ANTHROPIC_API_KEY),
  models: env.fallbackModels,
  cacheTtlS: env.CACHE_TTL_S,
  corsOrigins: env.corsOrigins,
  logger,
});
const server = app.listen(env.PORT, () => logger.info({ port: env.PORT, models: env.fallbackModels }, "gateway listening"));

function shutdown(): void {
  server.close(() => {
    redis.quit().finally(() => process.exit(0));
  });
  server.closeAllConnections();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
