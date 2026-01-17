/**
 * Hooks Barrel Export
 *
 * Composite hooks that wrap atoms into clean component APIs.
 * Components should import from here, not directly from atoms.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Composite Hooks section
 */

// Connection hook
export { useConnection, type UseConnectionResult } from "./useConnection";

// Room hook
export { useRoom, type UseRoomResult, type CreateStatus } from "./useRoom";

// Recording hook
export { useRecording, type UseRecordingResult } from "./useRecording";

// Turn hook
export { useTurn, type UseTurnResult, type SubmitStatus, type UploadStatus } from "./useTurn";
