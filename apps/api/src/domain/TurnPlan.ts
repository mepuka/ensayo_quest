import * as Schema from "effect/Schema";

export class TurnPlan extends Schema.Class<TurnPlan>("TurnPlan")({
  turnIndex: Schema.Number,
  speakerRole: Schema.String,
  promptType: Schema.Literal("user", "model"),
  objectiveIds: Schema.Array(Schema.String)
}) {}

export const decodeTurnPlan = Schema.decodeUnknownSync(TurnPlan);
export const encodeTurnPlan = Schema.encodeSync(TurnPlan);
