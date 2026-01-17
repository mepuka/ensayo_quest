/**
 * TopicCard - Individual topic selection card
 *
 * Displays a topic option with icon and description.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - RoomSetup section
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { cn } from "../../lib/utils";

export interface TopicCardProps {
  /**
   * Topic identifier.
   */
  topic: string;

  /**
   * Display title.
   */
  title: string;

  /**
   * Short description.
   */
  description: string;

  /**
   * Emoji or icon.
   */
  icon: string;

  /**
   * Whether this topic is selected.
   */
  selected?: boolean;

  /**
   * Click handler.
   */
  onClick?: () => void;
}

/**
 * Topic selection card for RoomSetup.
 *
 * @example
 * ```tsx
 * <TopicCard
 *   topic="travel"
 *   title="Travel"
 *   description="Discuss travel plans and destinations"
 *   icon="✈️"
 *   selected={topic === "travel"}
 *   onClick={() => setTopic("travel")}
 * />
 * ```
 */
export function TopicCard({
  topic,
  title,
  description,
  icon,
  selected = false,
  onClick
}: TopicCardProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected && "ring-2 ring-primary"
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{icon}</span>
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <CardDescription>{description}</CardDescription>
      </CardContent>
    </Card>
  );
}

/**
 * Available topics for practice sessions.
 */
export const TOPICS = [
  {
    topic: "travel",
    title: "Travel",
    description: "Discuss travel plans, destinations, and experiences",
    icon: "✈️"
  },
  {
    topic: "food",
    title: "Food & Dining",
    description: "Talk about restaurants, recipes, and cuisine",
    icon: "🍽️"
  },
  {
    topic: "work",
    title: "Work & Career",
    description: "Practice professional conversations",
    icon: "💼"
  },
  {
    topic: "hobbies",
    title: "Hobbies",
    description: "Share interests and leisure activities",
    icon: "🎨"
  }
] as const;

/**
 * Available proficiency levels.
 */
export const LEVELS = [
  { level: "A1", label: "Beginner", description: "Basic phrases and expressions" },
  { level: "A2", label: "Elementary", description: "Simple everyday topics" },
  { level: "B1", label: "Intermediate", description: "Familiar matters and travel" },
  { level: "B2", label: "Upper Intermediate", description: "Complex texts and discussions" }
] as const;
