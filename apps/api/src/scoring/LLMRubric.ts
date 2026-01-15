import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

export const RubricOutput = Schema.Struct({
  subscores: Schema.Struct({
    fluency: Schema.Number,
    vocab: Schema.Number,
    grammar: Schema.Number,
    relevance: Schema.Number,
    pronunciation: Schema.Number,
    naturalness: Schema.Number
  }),
  feedback: Schema.Struct({
    wins: Schema.Array(Schema.String),
    fixes: Schema.Array(Schema.String)
  })
});

export type RubricOutput = Schema.Schema.Type<typeof RubricOutput>;

export const parseRubricOutput = (input: string) =>
  Either.flatMap(Either.try(() => JSON.parse(input)), (json) =>
    Either.try({
      try: () => Schema.decodeUnknownSync(RubricOutput)(json),
      catch: (error) => error
    })
  );
