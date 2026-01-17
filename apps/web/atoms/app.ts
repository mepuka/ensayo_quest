/**
 * App Atoms - App readiness coordination
 *
 * Single appReadyAtom gates recording/submit actions.
 * Shows user-friendly status while dependencies load.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - App readiness section
 */
import { Atom, Result } from "@effect-atom/atom-react";
import * as Option from "effect/Option";
import { roomIdAtom, roomStateAtom } from "./room";
import { modelStatusAtom } from "./recording";
import { connectionStatusSimpleAtom } from "./connection";

// =============================================================================
// App Ready State
// =============================================================================

/**
 * App readiness states for user-friendly status.
 *
 * - idle: No room selected
 * - loading_model: ASR model loading
 * - connecting: WebSocket connecting
 * - syncing: Waiting for initial room state
 * - ready: All systems ready
 * - error: Unrecoverable error
 */
export type AppReadyState =
  | "idle"
  | "loading_model"
  | "connecting"
  | "syncing"
  | "ready"
  | "error";

/**
 * App readiness derived from all dependencies.
 *
 * Use this to gate recording/submit actions and
 * show a single, user-friendly readiness status.
 */
export const appReadyAtom = Atom.readable((get): AppReadyState => {
  const roomId = get(roomIdAtom);
  const model = get(modelStatusAtom);
  const connResult = get(connectionStatusSimpleAtom);
  const roomStateResult = get(roomStateAtom);

  // No room selected
  if (Option.isNone(roomId)) return "idle";

  // Model error is unrecoverable
  if (model === "error") return "error";

  // Model loading takes priority
  if (model !== "ready") return "loading_model";

  // Get connection status from result
  const conn = Result.isSuccess(connResult)
    ? Option.getOrElse(Result.value(connResult), () => "disconnected" as const)
    : "disconnected";

  // Connection status
  if (conn !== "connected") return "connecting";

  // Room state sync
  if (!Result.isSuccess(roomStateResult)) return "syncing";

  return "ready";
});
