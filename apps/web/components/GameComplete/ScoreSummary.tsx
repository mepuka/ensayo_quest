/**
 * ScoreSummary - Breakdown of performance
 *
 * Displays detailed score breakdown after session.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - GameComplete section
 */
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import { cn } from "../../lib/utils";
import type { ScoreEntry } from "../../atoms";

export interface ScoreSummaryProps {
  /**
   * Score history from the session.
   */
  scores: ReadonlyArray<ScoreEntry>;

  /**
   * Total cumulative score.
   */
  total: number;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Score summary with breakdown by turn.
 */
export function ScoreSummary({ scores, total, className }: ScoreSummaryProps) {
  const averageScore = scores.length > 0
    ? Math.round(total / scores.length)
    : 0;

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 90) return "Excellent";
    if (score >= 80) return "Great";
    if (score >= 70) return "Good";
    if (score >= 60) return "Fair";
    return "Needs Work";
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Session Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overall Stats */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-3xl font-bold">{total}</p>
            <p className="text-xs text-muted-foreground">Total Points</p>
          </div>
          <div>
            <p className="text-3xl font-bold">{scores.length}</p>
            <p className="text-xs text-muted-foreground">Turns</p>
          </div>
          <div>
            <p className={cn("text-3xl font-bold", getScoreColor(averageScore))}>
              {averageScore}
            </p>
            <p className="text-xs text-muted-foreground">Average</p>
          </div>
        </div>

        {/* Performance Badge */}
        <div className="text-center">
          <Badge
            variant={averageScore >= 70 ? "default" : "secondary"}
            className="text-lg px-4 py-2"
          >
            {getScoreLabel(averageScore)}
          </Badge>
        </div>

        {/* Turn Breakdown */}
        {scores.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Turn Breakdown</h4>
            <div className="space-y-2">
              {scores.map((entry, index) => (
                <div key={entry.turnId} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Turn {index + 1}</span>
                    <span className={cn("font-medium", getScoreColor(entry.score))}>
                      {entry.score}/100
                    </span>
                  </div>
                  <Progress value={entry.score} className="h-2" />
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
