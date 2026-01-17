/**
 * GameComplete - Game finished mode
 *
 * Displays final results and score summary.
 * Shown when room status is "completed".
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - GameComplete section
 */
import { useAtomValue } from "@effect-atom/atom-react";
import { useRoom } from "../../hooks";
import { scoreHistoryAtom, cumulativeScoreAtom } from "../../atoms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { ScoreSummary } from "./ScoreSummary";

/**
 * Game complete component for showing final results.
 *
 * Displays:
 * - Completion message
 * - Score summary with breakdown
 * - Play again button
 */
export function GameComplete() {
  const { state } = useRoom();
  const scoreHistory = useAtomValue(scoreHistoryAtom);
  const cumulativeScore = useAtomValue(cumulativeScoreAtom);

  const handlePlayAgain = () => {
    // Clear URL param to return to RoomSetup
    const url = new URL(window.location.href);
    url.searchParams.delete("roomId");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new Event("pushstate"));
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        {/* Completion Header */}
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Session Complete!</CardTitle>
            <CardDescription>
              {state?.completionSummary ?? "Great practice session!"}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <div className="text-6xl mb-2">🎉</div>
            <p className="text-muted-foreground">
              You've completed all the conversation turns.
            </p>
          </CardContent>
        </Card>

        {/* Score Summary */}
        <ScoreSummary
          scores={scoreHistory}
          total={cumulativeScore}
        />

        {/* Play Again */}
        <Button onClick={handlePlayAgain} className="w-full" size="lg">
          Start New Session
        </Button>
      </div>
    </div>
  );
}

// Re-export sub-components
export { ScoreSummary } from "./ScoreSummary";
