/**
 * GameSession - Active game mode
 *
 * Main game interface with recording, conversation, and scoring.
 * Shown when room exists and game is in progress.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - GameSession section
 */
import { useRoom, useTurn } from "../../hooks";
import { Button } from "../ui/button";
import { RecordingPanel } from "./RecordingPanel";
import { ConversationView } from "./ConversationView";
import { CurrentPrompt } from "./CurrentPrompt";
import { ScoreDisplay } from "./ScoreDisplay";
import { ConnectionStatus } from "./ConnectionStatus";

/**
 * Game session component for active practice.
 *
 * Layout:
 * - Header: Room ID, connection status, score
 * - Main: Current prompt, conversation history
 * - Footer: Recording controls, submit button
 */
export function GameSession() {
  const { roomId } = useRoom();
  const { canSubmit, submitTurn, submitStatus } = useTurn();

  return (
    <div className="min-h-screen flex flex-col max-w-2xl mx-auto">
      {/* Header */}
      <header className="sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10 border-b">
        <div className="flex items-center justify-between p-4">
          <h1 className="text-lg font-semibold truncate">
            Room: {roomId}
          </h1>
          <ConnectionStatus />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {/* Score Display */}
        <ScoreDisplay />

        {/* Current Prompt */}
        <CurrentPrompt />

        {/* Conversation History */}
        <ConversationView className="flex-1 min-h-0" />
      </main>

      {/* Footer - Recording Controls */}
      <footer className="sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t p-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <RecordingPanel />
          </div>

          {canSubmit && (
            <Button
              onClick={submitTurn}
              disabled={submitStatus === "pending"}
              size="lg"
            >
              {submitStatus === "pending" ? "Submitting..." : "Submit"}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

// Re-export sub-components for direct use if needed
export { RecordingPanel } from "./RecordingPanel";
export { ConversationView } from "./ConversationView";
export { CurrentPrompt } from "./CurrentPrompt";
export { ScoreDisplay } from "./ScoreDisplay";
export { ConnectionStatus } from "./ConnectionStatus";
