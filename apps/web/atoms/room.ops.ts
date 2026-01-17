/**
 * Room Operations - Re-export HTTP atoms
 *
 * HTTP operations are already defined in http/HttpAtoms.ts.
 * This file re-exports them for the atoms module interface.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Operation atoms section
 * @see http/HttpAtoms.ts - Actual implementation
 */
export {
  createRoomFn,
  submitTurnFn,
  uploadAudioFn,
  type CreateRoomInput,
  type SubmitTurnInput,
  type UploadAudioInput,
  type CreateRoomResult,
  type SubmitTurnResult,
  type UploadAudioResult
} from "../http/HttpAtoms";
