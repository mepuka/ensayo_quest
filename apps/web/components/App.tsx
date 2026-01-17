/**
 * App - Mode router component
 *
 * Routes between game modes based on room state.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Mode-Based Routing
 */
import { useRoom } from "../hooks";
import { RoomSetup } from "./RoomSetup";
import { GameSession } from "./GameSession";
import { GameComplete } from "./GameComplete";

/**
 * Main application component with mode routing.
 *
 * Routes to:
 * - RoomSetup: No room ID (user needs to create/join room)
 * - GameComplete: Room status is "completed"
 * - GameSession: Default (active game)
 */
export function App() {
  const { roomId, state } = useRoom();

  if (!roomId) {
    return <RoomSetup />;
  }

  if (state?.status === "completed") {
    return <GameComplete />;
  }

  return <GameSession />;
}
