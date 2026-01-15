import * as Schema from "effect/Schema";

export class TurnEvaluationResult extends Schema.Class<TurnEvaluationResult>("TurnEvaluationResult")({
  turnId: Schema.String,
  overall: Schema.Number,
  roleId: Schema.String,
  isFinal: Schema.Boolean
}) {}

export const decodeTurnEvaluationResult = Schema.decodeUnknownSync(TurnEvaluationResult);
export const encodeTurnEvaluationResult = Schema.encodeSync(TurnEvaluationResult);
