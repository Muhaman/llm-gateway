import { describe, expect, it } from "vitest";
import { cacheKey } from "../src/cache/key.js";

const base = { model: "m", max_tokens: 10, messages: [{ role: "user", content: "hi" }] };

describe("cacheKey", () => {
  it("is independent of key order, including nested objects", () => {
    const reordered = { messages: [{ content: "hi", role: "user" }], max_tokens: 10, model: "m" };
    expect(cacheKey(reordered)).toBe(cacheKey(base));
  });

  it("ignores stream and metadata", () => {
    const noisy = { ...base, stream: false, metadata: { user_id: "u1" } };
    expect(cacheKey(noisy)).toBe(cacheKey(base));
    expect(cacheKey({ ...base, stream: true, metadata: { user_id: "u2" } })).toBe(cacheKey(base));
  });

  it("differs when messages differ", () => {
    const other = { ...base, messages: [{ role: "user", content: "bye" }] };
    expect(cacheKey(other)).not.toBe(cacheKey(base));
  });

  it("keeps array order significant", () => {
    expect(cacheKey({ a: [1, 2] })).not.toBe(cacheKey({ a: [2, 1] }));
  });
});
