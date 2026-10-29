import { createHash } from "node:crypto";

const IGNORED_FIELDS = new Set(["stream", "metadata"]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((k) => [k, canonical(record[k])]),
    );
  }
  return value;
}

/** sha256 of the request with sorted keys, ignoring fields that do not change the completion. */
export function cacheKey(body: unknown): string {
  const input =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? Object.fromEntries(Object.entries(body).filter(([k]) => !IGNORED_FIELDS.has(k)))
      : body;
  return createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex");
}
