/**
 * CurrentPrompt - What user should respond to
 *
 * Displays the current prompt from NPC or seed prompt.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - GameSession section
 */
import { useTurn } from "../../hooks";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { cn } from "../../lib/utils";

export interface CurrentPromptProps {
  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Display for current conversation prompt.
 *
 * Shows either:
 * - The seed prompt (initial scenario)
 * - The latest NPC response to respond to
 */
export function CurrentPrompt({ className }: CurrentPromptProps) {
  const { currentPrompt } = useTurn();

  if (!currentPrompt) {
    return null;
  }

  return (
    <Card className={cn("border-primary/20", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Respond to:
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg leading-relaxed">{currentPrompt}</p>
      </CardContent>
    </Card>
  );
}
