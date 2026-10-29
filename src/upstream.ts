import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AppError } from "./errors.js";

/** The gateway validates only what it needs; everything else is forwarded untouched. */
export const messagesBodySchema = z.looseObject({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  messages: z.array(z.unknown()).min(1),
  stream: z.boolean().optional(),
});
export type MessagesBody = z.infer<typeof messagesBodySchema>;

/** Opaque Messages API response; the gateway forwards it verbatim and reads only usage/stop_reason. */
export type MessageResponse = object;

export interface StreamEvent {
  readonly type: string;
}

export type UpstreamReply = { response: MessageResponse } | { stream: AsyncIterable<StreamEvent> };
export type UpstreamResult = { model: string } & UpstreamReply;

/** A single-model call. Implementations throw UpstreamHttpError for HTTP and connection failures. */
export interface Upstream {
  send(body: MessagesBody, signal: AbortSignal): Promise<UpstreamReply>;
}

/** `status` is undefined for connection-level failures (DNS, reset, timeout). */
export class UpstreamHttpError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `upstream responded with ${status ?? "no response"}`);
    this.name = "UpstreamHttpError";
  }
}

export class UpstreamExhaustedError extends AppError {
  constructor() {
    super(502, "upstream_exhausted", "Every configured model failed or is overloaded.");
    this.name = "UpstreamExhaustedError";
  }
}

const isRetryable = (status: number | undefined): boolean =>
  status === undefined || status === 429 || status >= 500;

/** Requested model first (when configured), then the remaining models in order. */
export function modelChain(requested: string, models: readonly string[]): string[] {
  return models.includes(requested) ? [requested, ...models.filter((m) => m !== requested)] : [...models];
}

/**
 * Tries each model until one answers. 429/5xx/connection errors advance to the next model;
 * any other 4xx is the client's fault and is rethrown immediately for passthrough.
 */
export async function callUpstream(
  upstream: Upstream,
  body: MessagesBody,
  models: readonly string[],
  signal: AbortSignal,
  onError?: (status: string) => void,
): Promise<UpstreamResult> {
  for (const model of modelChain(body.model, models)) {
    try {
      const reply = await upstream.send({ ...body, model }, signal);
      return { model, ...reply };
    } catch (err) {
      if (signal.aborted || !(err instanceof UpstreamHttpError)) throw err;
      onError?.(String(err.status ?? "connection"));
      if (!isRetryable(err.status)) throw err;
    }
  }
  throw new UpstreamExhaustedError();
}

function toUpstreamError(err: unknown): unknown {
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.APIConnectionError) return new UpstreamHttpError(undefined, undefined, err.message);
  if (err instanceof Anthropic.APIError) return new UpstreamHttpError(err.status, err.error, err.message);
  return err;
}

/**
 * Anthropic SDK adapter. SDK retries are disabled so fallback decisions stay with the gateway,
 * and an explicit timeout lets the SDK accept large non-streaming max_tokens.
 */
export class AnthropicUpstream implements Upstream {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: 600_000 });
  }

  async send(body: MessagesBody, signal: AbortSignal): Promise<UpstreamReply> {
    try {
      // The API validates the remaining fields; the gateway forwards them verbatim.
      if (body.stream === true) {
        const params = body as unknown as Anthropic.MessageCreateParamsStreaming;
        return { stream: await this.client.messages.create(params, { signal }) };
      }
      const params = body as unknown as Anthropic.MessageCreateParamsNonStreaming;
      return { response: await this.client.messages.create(params, { signal }) };
    } catch (err) {
      throw toUpstreamError(err);
    }
  }
}
