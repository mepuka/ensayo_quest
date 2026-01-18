/**
 * ScoreDisplay - Running score display
 *
 * Shows cumulative and latest scores.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - GameSession section
 */
import { useAtomValue, Result } from "@effect-atom/atom-react";
import * as Option from "effect/Option";
import { cumulativeScoreAtom, latestScoreAtom, roomStateAtom } from "../../atoms";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";

export interface ScoreDisplayProps {
  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Running score display for game session.
 *
 * Shows:
 * - Cumulative score across all turns
 * - Latest turn score with change indicator
 */
export function ScoreDisplay({ className }: ScoreDisplayProps) {
  const cumulativeScore = useAtomValue(cumulativeScoreAtom);
  const latestScore = useAtomValue(latestScoreAtom);
  const roomStateResult = useAtomValue(roomStateAtom);
  const roomState = Result.isSuccess(roomStateResult)
    ? Option.getOrUndefined(Result.value(roomStateResult))
    : null;
  const scoringStatus = roomState?.turn.scoringStatus ?? "idle";
  const provisionalScore = roomState?.turn.evaluation?.overallScore ?? null;

  return (
    <Card className={cn("bg-secondary/50", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Score</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between" aria-live="polite">
          <div>
            <p className="text-3xl font-bold" aria-label={`Total score: ${cumulativeScore} points`}>
              {cumulativeScore}
            </p>
            <p className="text-xs text-muted-foreground">Total Points</p>
          </div>
          <div className="flex items-center gap-2">
            {latestScore !== null && (
              <Badge
                variant={latestScore.score >= 70 ? "default" : "secondary"}
                className="text-sm"
              >
                +{latestScore.score}
              </Badge>
            )}
            {scoringStatus === "pending" && (
              <Badge variant="secondary" className="text-sm">
                Scoring...
              </Badge>
            )}
            {scoringStatus === "partial" && (
              <Badge variant="secondary" className="text-sm">
                {provisionalScore === null ? "Provisional" : `Provisional ${provisionalScore}`}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
