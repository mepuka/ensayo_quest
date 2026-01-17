/**
 * Score Atoms - Derived atoms for score tracking
 *
 * Extracts score data from conversation history.
 * Provides cumulative and latest score atoms.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Score section
 */
import { Atom } from "@effect-atom/atom-react";
import { conversationHistoryAtom } from "./conversation";

// =============================================================================
// Score Types
// =============================================================================

/**
 * Individual score entry extracted from turn evaluation.
 */
export type ScoreEntry = {
  turnId: string;
  score: number;
  feedback: string;
  timestamp: number;
};

// =============================================================================
// Score History
// =============================================================================

/**
 * Score history extracted from turns with evaluations.
 * RoomHistoryEntry has `score: TurnEvaluation` (optional).
 */
export const scoreHistoryAtom = Atom.readable((get): ReadonlyArray<ScoreEntry> => {
  const history = get(conversationHistoryAtom);
  return history
    .filter((h) => h.score !== undefined)
    .map((h) => ({
      turnId: h.turnId,
      score: h.score?.overallScore ?? 0,
      // TurnEvaluation.feedback is an array, join for display
      feedback: h.score?.feedback?.join(". ") ?? "",
      // RoomHistoryEntry doesn't have timestamp, use 0 as placeholder
      timestamp: 0
    }));
});

// =============================================================================
// Cumulative Score
// =============================================================================

/**
 * Total cumulative score across all turns.
 */
export const cumulativeScoreAtom = scoreHistoryAtom.pipe(
  Atom.map((history) => history.reduce((sum, s) => sum + s.score, 0))
);

// =============================================================================
// Latest Score
// =============================================================================

/**
 * Most recent score entry, or null if no scores yet.
 */
export const latestScoreAtom = scoreHistoryAtom.pipe(
  Atom.map((history) => history[history.length - 1] ?? null)
);

// =============================================================================
// Average Score
// =============================================================================

/**
 * Average score across all turns, or 0 if no scores.
 */
export const averageScoreAtom = scoreHistoryAtom.pipe(
  Atom.map((history) => {
    if (history.length === 0) return 0;
    const total = history.reduce((sum, s) => sum + s.score, 0);
    return total / history.length;
  })
);
