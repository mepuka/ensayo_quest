import * as Schema from "effect/Schema";

export class AwaitingTurn extends Schema.Class<AwaitingTurn>("AwaitingTurn")({
  _tag: Schema.Literal("AwaitingTurn"),
  userId: Schema.String
}) {}

export class Evaluating extends Schema.Class<Evaluating>("Evaluating")({
  _tag: Schema.Literal("Evaluating"),
  turnId: Schema.String
}) {}

export class AwaitingOtherUser extends Schema.Class<AwaitingOtherUser>("AwaitingOtherUser")({
  _tag: Schema.Literal("AwaitingOtherUser"),
  userId: Schema.String
}) {}

export class Complete extends Schema.Class<Complete>("Complete")({
  _tag: Schema.Literal("Complete")
}) {}

export class TurnSubmitted extends Schema.Class<TurnSubmitted>("TurnSubmitted")({
  _tag: Schema.Literal("TurnSubmitted"),
  turnId: Schema.String,
  userId: Schema.String
}) {}

export class TurnEvaluated extends Schema.Class<TurnEvaluated>("TurnEvaluated")({
  _tag: Schema.Literal("TurnEvaluated"),
  turnId: Schema.String
}) {}

export class ScenarioComplete extends Schema.Class<ScenarioComplete>("ScenarioComplete")({
  _tag: Schema.Literal("ScenarioComplete")
}) {}

export const RoomStateSchema = Schema.Union(
  AwaitingTurn,
  Evaluating,
  AwaitingOtherUser,
  Complete
);

export const RoomEventSchema = Schema.Union(
  TurnSubmitted,
  TurnEvaluated,
  ScenarioComplete
);

export type RoomState = Schema.Schema.Type<typeof RoomStateSchema>;
export type RoomEvent = Schema.Schema.Type<typeof RoomEventSchema>;

export const decodeRoomState = Schema.decodeUnknownSync(RoomStateSchema);
export const encodeRoomState = Schema.encodeSync(RoomStateSchema);
export const decodeRoomEvent = Schema.decodeUnknownSync(RoomEventSchema);
export const encodeRoomEvent = Schema.encodeSync(RoomEventSchema);

export const advance = (state: RoomState, event: RoomEvent): RoomState => {
  switch (state._tag) {
    case "AwaitingTurn":
      return event._tag === "TurnSubmitted"
        ? new Evaluating({ _tag: "Evaluating", turnId: event.turnId })
        : state;
    case "Evaluating":
      return event._tag === "TurnEvaluated"
        ? new AwaitingOtherUser({ _tag: "AwaitingOtherUser", userId: "" })
        : state;
    case "AwaitingOtherUser":
      return event._tag === "TurnSubmitted"
        ? new Evaluating({ _tag: "Evaluating", turnId: event.turnId })
        : state;
    case "Complete":
      return state;
  }
};
