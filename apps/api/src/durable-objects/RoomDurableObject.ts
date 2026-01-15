export type ScoreUpdateStatus = "partial" | "final";

export class RoomDurableObject {
  static buildScoreUpdated(input: { turnId: string; status: ScoreUpdateStatus }) {
    return {
      event: "ScoreUpdated",
      turnId: input.turnId,
      status: input.status
    };
  }

  static buildNpcPromptUpdated(input: { turnId: string; prompt: string }) {
    return {
      event: "NpcPromptUpdated",
      turnId: input.turnId,
      prompt: input.prompt
    };
  }
}
