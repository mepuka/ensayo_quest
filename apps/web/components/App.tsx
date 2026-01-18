/**
 * App - Mode router component
 *
 * Routes between game modes based on room state.
 * Triggers model preload on mount for better UX.
 * Renders Voice Lab in dev mode when ?voiceLab=1 is present.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Mode-Based Routing
 * @see ensayo_quest-qnj: Phase 4 - Voice Lab
 */
import { useEffect, useRef, useMemo } from "react";
import { useAtomSet } from "@effect-atom/atom-react";
import { useRoom } from "../hooks";
import { RoomSetup } from "./RoomSetup";
import { GameSession } from "./GameSession";
import { GameComplete } from "./GameComplete";
import { VoiceLab } from "./dev/VoiceLab";
import { preloadModelFn } from "../atoms";

/**
 * Check if Voice Lab should be shown.
 * Only in dev mode with ?voiceLab=1 URL parameter.
 */
const useVoiceLabMode = () => {
  return useMemo(() => {
    // Check for dev mode - Bun sets NODE_ENV to development
    const isDev = typeof window !== "undefined" &&
      (process.env.NODE_ENV === "development" ||
       window.location.hostname === "localhost");

    if (!isDev) return false;

    // Check URL parameter
    const params = new URLSearchParams(window.location.search);
    return params.get("voiceLab") === "1";
  }, []);
};

/**
 * Main application component with mode routing.
 *
 * Routes to:
 * - VoiceLab: Dev mode with ?voiceLab=1 parameter
 * - RoomSetup: No room ID (user needs to create/join room)
 * - GameComplete: Room status is "completed"
 * - GameSession: Default (active game)
 *
 * Triggers ASR model preload on first mount for instant transcription later.
 */
export function App() {
  const isVoiceLab = useVoiceLabMode();
  const { roomId, state } = useRoom();
  const preload = useAtomSet(preloadModelFn);
  const hasPreloadedRef = useRef(false);

  // Preload ASR model once on mount
  useEffect(() => {
    if (!hasPreloadedRef.current) {
      hasPreloadedRef.current = true;
      preload();
    }
  }, [preload]);

  // Voice Lab mode - dev harness for voice stack testing
  if (isVoiceLab) {
    return <VoiceLab />;
  }

  if (!roomId) {
    return <RoomSetup />;
  }

  if (state?.status === "completed") {
    return <GameComplete />;
  }

  return <GameSession />;
}
