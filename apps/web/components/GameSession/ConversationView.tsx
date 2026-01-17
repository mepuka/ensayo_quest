/**
 * ConversationView - Turn history with pending overlay
 *
 * Displays conversation bubbles with optimistic pending turns.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - GameSession section
 */
import { useAtomValue } from "@effect-atom/atom-react";
import { conversationWithPendingAtom } from "../../atoms";
import { ConversationList } from "../shared/ConversationBubble";
import { cn } from "../../lib/utils";

export interface ConversationViewProps {
  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Scrollable conversation history with pending turns.
 *
 * Uses conversationWithPendingAtom which overlays optimistic
 * pending turns on top of confirmed history.
 */
export function ConversationView({ className }: ConversationViewProps) {
  const conversation = useAtomValue(conversationWithPendingAtom);

  if (conversation.length === 0) {
    return (
      <div className={cn("flex items-center justify-center p-8", className)}>
        <p className="text-muted-foreground">
          Start speaking to begin the conversation
        </p>
      </div>
    );
  }

  return (
    <ConversationList
      entries={conversation}
      {...(className !== undefined && { className })}
    />
  );
}
