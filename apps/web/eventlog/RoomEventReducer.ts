import type { RoomEvent } from "../../shared/src/RoomProtocol";

export type ScorePanelStatus = "pending" | "partial" | "final";

export type ScorePanelState = {
  turnId: string;
  status: ScorePanelStatus;
  overall: number | null;
  npcPrompt: string | null;
};

export const initialScorePanelState = (turnId: string): ScorePanelState => ({
  turnId,
  status: "pending",
  overall: null,
  npcPrompt: null
});

export const reduceRoomEvent = (
  state: ScorePanelState,
  event: RoomEvent
): ScorePanelState => {
  switch (event.type) {
    case "TurnAccepted":
      return {
        ...state,
        turnId: event.turnId,
        status: "pending",
        overall: null
      };
    case "ScoreUpdated":
      return {
        ...state,
        turnId: event.turnId,
        status: "final",
        overall: event.evaluation.overallScore,
        npcPrompt: event.evaluation.nextPrompt
      };
    default:
      return state;
  }
};
