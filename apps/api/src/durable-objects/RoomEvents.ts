export type ScoreUpdateStatus = "partial" | "final";

export const buildScoreUpdated = (input: { turnId: string; status: ScoreUpdateStatus }) => ({
  event: "ScoreUpdated",
  turnId: input.turnId,
  status: input.status
});

export const buildNpcPromptUpdated = (input: { turnId: string; prompt: string }) => ({
  event: "NpcPromptUpdated",
  turnId: input.turnId,
  prompt: input.prompt
});
