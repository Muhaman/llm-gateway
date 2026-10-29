import type { Logger } from "./logger.js";
import { PRICING } from "./pricing.js";

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
}

const PER_MTOK = 1_000_000;

/** Cost in USD. Unknown models cost 0 and log a warning so spend is never silently misattributed. */
export function costUsd(model: string, u: Usage, log?: Pick<Logger, "warn">): number {
  const price = PRICING[model];
  if (!price) {
    log?.warn({ model }, "no pricing for model; recording zero cost");
    return 0;
  }
  return (
    (u.input_tokens * price.input + u.output_tokens * price.output + (u.cache_read_input_tokens ?? 0) * price.cacheRead) /
    PER_MTOK
  );
}
