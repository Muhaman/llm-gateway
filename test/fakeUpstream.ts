import {
  UpstreamHttpError,
  type MessagesBody,
  type StreamEvent,
  type Upstream,
  type UpstreamReply,
} from "../src/upstream.js";

export interface Call {
  model: string;
  body: MessagesBody;
  signal: AbortSignal;
}

export type Handler = (call: Call) => Promise<UpstreamReply> | UpstreamReply;

export function messageReply(
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number } = {
    input_tokens: 10,
    output_tokens: 5,
  },
): UpstreamReply {
  return {
    response: {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage,
    },
  };
}

export function failWith(status: number | undefined, body?: unknown): never {
  throw new UpstreamHttpError(status, body, `fake upstream failure ${status ?? "connection"}`);
}

/** Emits the given events, then stays open until the request signal aborts. */
export function heldStream(events: StreamEvent[], signal: AbortSignal): UpstreamReply {
  async function* generate(): AsyncGenerator<StreamEvent> {
    for (const event of events) yield event;
    if (signal.aborted) return;
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  }
  return { stream: generate() };
}

export function finishedStream(events: StreamEvent[]): UpstreamReply {
  async function* generate(): AsyncGenerator<StreamEvent> {
    for (const event of events) yield event;
  }
  return { stream: generate() };
}

export const STREAM_EVENTS: Array<StreamEvent & Record<string, unknown>> = [
  { type: "message_start", message: { id: "msg_s", usage: { input_tokens: 12, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
  { type: "message_stop" },
];

export class FakeUpstream implements Upstream {
  readonly calls: Call[] = [];

  constructor(private handler: Handler = ({ model }) => messageReply(model)) {}

  setHandler(handler: Handler): void {
    this.handler = handler;
  }

  async send(body: MessagesBody, signal: AbortSignal): Promise<UpstreamReply> {
    const call = { model: body.model, body, signal };
    this.calls.push(call);
    return this.handler(call);
  }
}
