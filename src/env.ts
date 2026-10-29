import { z } from "zod";

const schema = z
  .object({
    ANTHROPIC_API_KEY: z.string().min(1),
    REDIS_URL: z.string().min(1),
    FALLBACK_MODELS: z.string().default("claude-opus-5-5,claude-sonnet-5-5"),
    CACHE_TTL_S: z.coerce.number().int().positive().default(3600),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGINS: z.string().default(""),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  })
  .transform((env, ctx) => {
    const fallbackModels = splitList(env.FALLBACK_MODELS);
    if (fallbackModels.length === 0) {
      ctx.addIssue({ code: "custom", path: ["FALLBACK_MODELS"], message: "must list at least one model" });
      return z.NEVER;
    }
    return { ...env, fallbackModels, corsOrigins: splitList(env.CORS_ORIGINS) };
  });

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export type Env = z.output<typeof schema>;

export function loadEnv(src: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(src);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment: ${problems.join("; ")}`);
  }
  return result.data;
}
