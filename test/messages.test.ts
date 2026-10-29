import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { failWith, finishedStream, FakeUpstream, heldStream, messageReply, STREAM_EVENTS } from "./fakeUpstream.js";
import { buildHarness, REQUEST_BODY } from "./harness.js";

const upstream = new FakeUpstream();
const h = buildHarness(upstream);
afterAll(h.cleanup);

const post = (key: string, body: object) => request(h.app).post("/v1/messages").set("x-api-key", key).send(body);

describe("POST /v1/messages", () => {
  it("serves an identical second non-stream request from cache", async () => {
    const key = await h.newKey();
    upstream.calls.length = 0;
    upstream.setHandler(({ model }) => messageReply(model));
    const body = { ...REQUEST_BODY, max_tokens: 101 };

    const first = await post(key, body);
    const second = await post(key, { max_tokens: 101, messages: body.messages, model: body.model });

    expect(first.headers["x-gateway-cache"]).toBe("MISS");
    expect(second.headers["x-gateway-cache"]).toBe("HIT");
    expect(second.headers["x-gateway-model"]).toBe("claude-opus-5-5");
    expect(second.headers["x-request-id"]).toBeTruthy();
    expect(second.body).toEqual(first.body);
    expect(upstream.calls).toHaveLength(1);

    const metrics = await request(h.app).get("/metrics");
    expect(metrics.text).toMatch(/gateway_cache_hits_total 1/);
    expect(metrics.text).toMatch(/gateway_tokens_total\{direction="input",model="claude-opus-5-5"\} 10/);
  });

  it("does not share cache entries between api keys", async () => {
    const [a, b] = [await h.newKey(), await h.newKey()];
    upstream.calls.length = 0;
    const body = { ...REQUEST_BODY, max_tokens: 102 };
    await post(a, body);
    const res = await post(b, body);
    expect(res.headers["x-gateway-cache"]).toBe("MISS");
    expect(upstream.calls).toHaveLength(2);
  });

  it("never caches a stream request and re-emits SSE events", async () => {
    const key = await h.newKey();
    upstream.calls.length = 0;
    upstream.setHandler(() => finishedStream(STREAM_EVENTS));
    const body = { ...REQUEST_BODY, max_tokens: 103, stream: true };

    const first = await post(key, body);
    const second = await post(key, body);

    expect(first.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(first.headers["x-gateway-cache"]).toBe("MISS");
    expect(second.headers["x-gateway-cache"]).toBe("MISS");
    expect(upstream.calls).toHaveLength(2);
    expect(first.text).toContain('event: message_start\ndata: {"type":"message_start"');
    expect(first.text.trimEnd().endsWith('event: message_stop\ndata: {"type":"message_stop"}')).toBe(true);

    const usage = await request(h.app).get("/v1/usage").set("x-api-key", key);
    expect(usage.body.total).toMatchObject({ input: 24, output: 14, requests: 2 });
  });

  it("falls back to the next model when the first is overloaded (529)", async () => {
    const key = await h.newKey();
    upstream.calls.length = 0;
    upstream.setHandler(({ model }) => (model === "claude-opus-5-5" ? failWith(529) : messageReply(model)));

    const res = await post(key, { ...REQUEST_BODY, max_tokens: 104 });

    expect(res.status).toBe(200);
    expect(res.headers["x-gateway-model"]).toBe("claude-sonnet-5-5");
    expect(upstream.calls.map((c) => c.model)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    const metrics = await request(h.app).get("/metrics");
    expect(metrics.text).toMatch(/gateway_upstream_errors_total\{status="529"\} 1/);
  });

  it("falls back on connection errors", async () => {
    const key = await h.newKey();
    upstream.setHandler(({ model }) => (model === "claude-opus-5-5" ? failWith(undefined) : messageReply(model)));
    const res = await post(key, { ...REQUEST_BODY, max_tokens: 105 });
    expect(res.headers["x-gateway-model"]).toBe("claude-sonnet-5-5");
  });

  it("returns 502 upstream_exhausted when every model fails", async () => {
    const key = await h.newKey();
    upstream.setHandler(() => failWith(529));
    const res = await post(key, { ...REQUEST_BODY, max_tokens: 106 });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("upstream_exhausted");
  });

  it("passes an upstream 400 through unchanged without falling back", async () => {
    const key = await h.newKey();
    upstream.calls.length = 0;
    const errorBody = { type: "error", error: { type: "invalid_request_error", message: "bad" } };
    upstream.setHandler(() => failWith(400, errorBody));

    const res = await post(key, { ...REQUEST_BODY, max_tokens: 107 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(errorBody);
    expect(upstream.calls).toHaveLength(1);
  });

  it("rejects an invalid body and a model outside the allowlist with 400", async () => {
    const key = await h.newKey();
    expect((await post(key, { model: "claude-opus-5-5" })).status).toBe(400);
    const res = await post(key, { ...REQUEST_BODY, model: "claude-other" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("model_not_allowed");
  });

  it("aborts the upstream request when the client disconnects mid-stream", async () => {
    const key = await h.newKey();
    upstream.calls.length = 0;
    upstream.setHandler(({ signal }) => heldStream(STREAM_EVENTS.slice(0, 3), signal));
    const server = h.app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const payload = JSON.stringify({ ...REQUEST_BODY, max_tokens: 108, stream: true });
    const clientReq = http.request({
      port,
      method: "POST",
      path: "/v1/messages",
      headers: { "content-type": "application/json", "x-api-key": key },
    });
    clientReq.on("error", () => undefined);
    clientReq.on("response", (res) => {
      res.once("data", () => clientReq.destroy());
      res.on("error", () => undefined);
    });
    clientReq.end(payload);

    try {
      await vi.waitFor(() => {
        expect(upstream.calls).toHaveLength(1);
        expect(upstream.calls[0]?.signal.aborted).toBe(true);
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
