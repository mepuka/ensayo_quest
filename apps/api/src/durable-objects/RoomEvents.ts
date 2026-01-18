export type ScoreUpdateStatus = "partial" | "final";

export const buildScoreUpdated = (input: {
  turnId: string;
  status: ScoreUpdateStatus;
  scoreAttemptId?: string;
}) => ({
  event: "ScoreUpdated",
  turnId: input.turnId,
  status: input.status,
  scoreAttemptId: input.scoreAttemptId ?? "score-attempt"
});

export const buildNpcPromptUpdated = (input: { turnId: string; prompt: string }) => ({
  event: "NpcPromptUpdated",
  turnId: input.turnId,
  prompt: input.prompt
});
