export type RoomState =
  | { _tag: "AwaitingTurn"; userId: string }
  | { _tag: "Evaluating"; turnId: string }
  | { _tag: "AwaitingOtherUser"; userId: string }
  | { _tag: "Complete" };

export type RoomEvent =
  | { _tag: "TurnSubmitted"; turnId: string; userId: string }
  | { _tag: "TurnEvaluated"; turnId: string }
  | { _tag: "ScenarioComplete" };

export const advance = (state: RoomState, event: RoomEvent): RoomState => {
  switch (state._tag) {
    case "AwaitingTurn":
      return event._tag === "TurnSubmitted"
        ? { _tag: "Evaluating", turnId: event.turnId }
        : state;
    case "Evaluating":
      return event._tag === "TurnEvaluated"
        ? { _tag: "AwaitingOtherUser", userId: "" }
        : state;
    case "AwaitingOtherUser":
      return event._tag === "TurnSubmitted"
        ? { _tag: "Evaluating", turnId: event.turnId }
        : state;
    case "Complete":
      return state;
  }
};
