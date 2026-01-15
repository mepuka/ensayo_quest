import React from "react";

export type ScorePanelProps = {
  turnId: string;
  status: "pending" | "partial" | "final";
  overall: number | null;
};

export const ScorePanel = ({ turnId, status, overall }: ScorePanelProps) => {
  return (
    <section data-status={status} data-turn-id={turnId}>
      <h2>Turn Score</h2>
      <p>{overall === null ? "Scoring..." : `Overall: ${overall}`}</p>
    </section>
  );
};
