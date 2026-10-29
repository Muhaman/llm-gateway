import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";

const valid = { ANTHROPIC_API_KEY: "sk-test", REDIS_URL: "redis://localhost:6379" };

describe("loadEnv", () => {
  it("applies defaults", () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.CACHE_TTL_S).toBe(3600);
    expect(env.fallbackModels).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
  });

  it("throws naming REDIS_URL when it is missing", () => {
    expect(() => loadEnv({ ANTHROPIC_API_KEY: "sk-test" })).toThrow(/REDIS_URL/);
  });

  it("throws naming ANTHROPIC_API_KEY when it is missing", () => {
    expect(() => loadEnv({ REDIS_URL: "redis://localhost:6379" })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("parses a custom FALLBACK_MODELS list", () => {
    const env = loadEnv({ ...valid, FALLBACK_MODELS: " claude-haiku-5-5 , claude-sonnet-5-5 " });
    expect(env.fallbackModels).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
  });
});
