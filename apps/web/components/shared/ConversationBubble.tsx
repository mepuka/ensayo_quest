/**
 * ConversationBubble - Player/NPC turn display
 *
 * Visual distinction between user and NPC messages.
 * Supports pending state for optimistic UI.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Custom components
 */
import * as React from "react";
import { Card, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";

export interface ConversationBubbleProps {
  /**
   * Role of the speaker.
   */
  role: "user" | "npc";

  /**
   * Message text.
   */
  text: string;

  /**
   * Whether this is a pending (optimistic) message.
   */
  pending?: boolean;

  /**
   * Score for this turn (if available).
   */
  score?: number;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Conversation bubble for turn history display.
 *
 * User messages appear on the right with primary styling.
 * NPC messages appear on the left with secondary styling.
 * Pending messages show with reduced opacity.
 *
 * @example
 * ```tsx
 * {conversation.map((entry) => (
 *   <ConversationBubble
 *     key={entry.turnId}
 *     role={entry.role}
 *     text={entry.text}
 *     pending={entry.pending}
 *   />
 * ))}
 * ```
 */
export function ConversationBubble({
  role,
  text,
  pending = false,
  score,
  className
}: ConversationBubbleProps) {
  const isUser = role === "user";
  const align = isUser ? "justify-end" : "justify-start";
  const bgClass = isUser
    ? "bg-primary text-primary-foreground"
    : "bg-secondary text-secondary-foreground";
  const label = isUser ? "You" : "Tutor";

  return (
    <div className={cn("flex w-full", align, className)}>
      <Card
        className={cn(
          "max-w-[80%] transition-opacity",
          bgClass,
          pending && "opacity-60"
        )}
      >
        <CardContent className="p-3">
          {/* Header with role and optional score */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-medium opacity-70">{label}</span>
            {score !== undefined && (
              <Badge variant="outline" className="text-xs">
                {score}/100
              </Badge>
            )}
            {pending && (
              <Badge variant="outline" className="text-xs">
                Sending...
              </Badge>
            )}
          </div>

          {/* Message text */}
          <p className="text-sm whitespace-pre-wrap">{text}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// Conversation List
// =============================================================================

export interface ConversationListProps {
  /**
   * Array of conversation entries.
   */
  entries: ReadonlyArray<{
    turnId: string;
    role: "user" | "npc";
    text: string;
    pending?: boolean;
    score?: number;
  }>;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Scrollable list of conversation bubbles.
 *
 * @example
 * ```tsx
 * const conversation = useAtomValue(conversationWithPendingAtom);
 * <ConversationList entries={conversation} />
 * ```
 */
export function ConversationList({ entries, className }: ConversationListProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries added
  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col gap-3 overflow-y-auto p-4",
        className
      )}
      aria-live="polite"
      aria-label="Conversation history"
    >
      {entries.map((entry) => (
        <ConversationBubble
          key={entry.turnId}
          role={entry.role}
          text={entry.text}
          {...(entry.pending !== undefined && { pending: entry.pending })}
          {...(entry.score !== undefined && { score: entry.score })}
        />
      ))}
    </div>
  );
}
