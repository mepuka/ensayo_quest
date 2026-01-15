import * as Schema from "effect/Schema";

export const decodeJson = <A, I>(schema: Schema.Schema<A, I>, input: string): A =>
  Schema.decodeUnknownSync(Schema.parseJson(schema))(input);

export const encodeJson = <A, I>(schema: Schema.Schema<A, I>, value: A): string =>
  Schema.encodeSync(Schema.parseJson(schema))(value);
