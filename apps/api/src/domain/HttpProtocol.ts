/**
 * HTTP Protocol - Re-exported from @ensayo/shared
 *
 * This file re-exports HTTP protocol schemas from the shared package
 * to maintain a single source of truth between frontend and backend.
 *
 * @see apps/shared/src/HttpProtocol.ts for canonical definitions
 */
export {
  // Request schemas
  CreateRoomRequest,
  HttpTurnSubmission,
  // Response schemas
  CreateRoomResponse,
  SubmitTurnResponse,
  TurnAudioResponse,
  HttpErrorResponse,
  // Encoders/Decoders
  decodeCreateRoomRequest,
  encodeCreateRoomRequest,
  decodeCreateRoomResponse,
  encodeCreateRoomResponse,
  decodeSubmitTurnResponse,
  encodeSubmitTurnResponse,
  decodeTurnAudioResponse,
  encodeTurnAudioResponse,
  decodeHttpErrorResponse,
  encodeHttpErrorResponse,
  decodeHttpTurnSubmission,
  encodeHttpTurnSubmission,
  // Types
  type CreateRoomInput,
  type SubmitTurnInput,
  type CreateRoomResult,
  type SubmitTurnResult,
  type UploadAudioResult
} from "@ensayo/shared";
