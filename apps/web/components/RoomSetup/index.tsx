/**
 * RoomSetup - Room creation/join mode
 *
 * Displays topic/level selection and room creation controls.
 * Shown when no roomId is present.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - RoomSetup section
 */
import { useState } from "react";
import { useRoom } from "../../hooks";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { TopicCard, TOPICS, LEVELS } from "./TopicCard";

/**
 * Room setup component for creating new game rooms.
 *
 * Uses requestId for idempotent room creation (Architecture Invariant #10).
 */
export function RoomSetup() {
  const { create, createStatus, createError } = useRoom();

  // Local UI state for topic/level selection
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);

  const canCreate = selectedTopic !== null && selectedLevel !== null && createStatus !== "pending";

  const handleCreate = () => {
    if (!canCreate || !selectedTopic || !selectedLevel) return;

    // Generate requestId at click time for idempotency
    const requestId = crypto.randomUUID();
    create({
      requestId,
      topic: selectedTopic,
      level: selectedLevel,
      mode: "practice"
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">Ensayo Quest</CardTitle>
          <CardDescription>
            Practice your Spanish conversation skills with an AI tutor
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Topic Selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium" id="topic-label">Choose a Topic</h3>
            <div className="grid grid-cols-2 gap-3" role="group" aria-labelledby="topic-label">
              {TOPICS.map((t) => (
                <TopicCard
                  key={t.topic}
                  {...t}
                  selected={selectedTopic === t.topic}
                  onClick={() => setSelectedTopic(t.topic)}
                />
              ))}
            </div>
          </div>

          {/* Level Selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium" id="level-label">Select Your Level</h3>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="level-label">
              {LEVELS.map((l) => (
                <Badge
                  key={l.level}
                  variant={selectedLevel === l.level ? "default" : "outline"}
                  className="cursor-pointer px-4 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => setSelectedLevel(l.level)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedLevel(l.level);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-pressed={selectedLevel === l.level}
                >
                  {l.level} - {l.label}
                </Badge>
              ))}
            </div>
            {selectedLevel && (
              <p className="text-sm text-muted-foreground">
                {LEVELS.find((l) => l.level === selectedLevel)?.description}
              </p>
            )}
          </div>

          {/* Error Display */}
          {createError !== null && (
            <div className="rounded-md bg-destructive/10 p-3">
              <p className="text-sm text-destructive">
                Failed to create room. Please try again.
              </p>
            </div>
          )}

          {/* Create Button */}
          <Button
            onClick={handleCreate}
            disabled={!canCreate}
            className="w-full"
            size="lg"
          >
            {createStatus === "pending" ? "Creating Room..." : "Start Practice Session"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
