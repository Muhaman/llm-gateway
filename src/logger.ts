import { pino, type Logger } from "pino";

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: "llm-gateway" },
    // Defense in depth: never let credentials reach logs, even if a request or error object is logged.
    redact: {
      paths: [
        'req.headers["x-api-key"]',
        "req.headers.authorization",
        '*.headers["x-api-key"]',
        "*.headers.authorization",
        "err.headers",
      ],
      censor: "[redacted]",
    },
  });
}
