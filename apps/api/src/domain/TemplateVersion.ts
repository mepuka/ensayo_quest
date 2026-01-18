import { Effect } from "effect";
import * as Schema from "effect/Schema";

export class TemplateVersionError extends Schema.TaggedError<TemplateVersionError>()(
  "TemplateVersionError",
  { reason: Schema.String }
) {}

const sortKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b)
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      sorted[key] = sortKeysDeep(entryValue);
    }
    return sorted;
  }
  return value;
};

export const stableJsonStringify = (value: unknown): string =>
  JSON.stringify(sortKeysDeep(value));

const toHex = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
};

export const hashSha256 = (input: string) =>
  Effect.tryPromise({
    try: async () => {
      const data = new TextEncoder().encode(input);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return toHex(digest);
    },
    catch: (cause) => new TemplateVersionError({ reason: String(cause) })
  });

export const computeTemplateVersion = (value: unknown) =>
  hashSha256(stableJsonStringify(value));
