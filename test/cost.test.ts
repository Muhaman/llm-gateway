import { describe, expect, it, vi } from "vitest";
import { costUsd } from "../src/cost.js";

describe("costUsd", () => {
  it("prices opus-5-5 at 4/20 per MTok", () => {
    expect(costUsd("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(24);
  });

  it("prices haiku-5-5 input at 0.10 per MTok", () => {
    expect(costUsd("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(0.1);
  });

  it("prices sonnet-5-5 cache reads at 0.20 per MTok", () => {
    const usd = costUsd("claude-sonnet-5-5", {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(0.2);
  });

  it("returns 0 and warns for an unknown model", () => {
    const warn = vi.fn();
    expect(costUsd("claude-unknown", { input_tokens: 5, output_tokens: 5 }, { warn })).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
  });
});
