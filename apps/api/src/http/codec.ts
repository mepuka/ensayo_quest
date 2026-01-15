import * as Schema from "effect/Schema";

export const decodeJson = <A, I>(schema: Schema.Schema<A, I>, input: string): A => {
  const decoded = Schema.decodeUnknownSync(schema)(JSON.parse(input));
  return decoded;
};

export const encodeJson = <A, I>(schema: Schema.Schema<A, I>, value: A): string => {
  const encoded = Schema.encodeSync(schema)(value);
  return JSON.stringify(encoded);
};
