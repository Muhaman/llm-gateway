import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildHarness, REQUEST_BODY } from "./harness.js";

const h = buildHarness();
afterAll(h.cleanup);

describe("auth", () => {
  it("rejects a request without a key with 401 JSON", async () => {
    const res = await request(h.app).post("/v1/messages").send(REQUEST_BODY);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("rejects an unknown key with 401", async () => {
    const res = await request(h.app).post("/v1/messages").set("x-api-key", "gw_nope").send(REQUEST_BODY);
    expect(res.status).toBe(401);
  });

  it("returns 429 with retry-after once the key exceeds its rpm", async () => {
    const key = await h.newKey({ rpm: 2 });
    const send = () => request(h.app).post("/v1/messages").set("x-api-key", key).send(REQUEST_BODY);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(limited.body.error.code).toBe("rate_limited");
  });

  it("returns 429 once the daily token budget is spent", async () => {
    const key = await h.newKey({ dailyTokens: 10 });
    const first = await request(h.app).post("/v1/messages").set("x-api-key", key).send({ ...REQUEST_BODY, max_tokens: 65 });
    expect(first.status).toBe(200);
    const second = await request(h.app).post("/v1/messages").set("x-api-key", key).send({ ...REQUEST_BODY, max_tokens: 66 });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("daily_tokens_exceeded");
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("serves /healthz without a key", async () => {
    expect((await request(h.app).get("/healthz")).status).toBe(200);
  });

  it("reports usage for the calling key only", async () => {
    const key = await h.newKey();
    await request(h.app).post("/v1/messages").set("x-api-key", key).send({ ...REQUEST_BODY, max_tokens: 70 });
    const res = await request(h.app).get("/v1/usage?days=2").set("x-api-key", key);
    expect(res.status).toBe(200);
    expect(res.body.total).toMatchObject({ input: 10, output: 5, requests: 1 });
    const other = await h.newKey();
    const otherRes = await request(h.app).get("/v1/usage").set("x-api-key", other);
    expect(otherRes.body.total.requests).toBe(0);
  });
});
