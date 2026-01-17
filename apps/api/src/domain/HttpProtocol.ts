import * as Schema from "effect/Schema";

export class CreateRoomRequest extends Schema.Class<CreateRoomRequest>("CreateRoomRequest")({
  /** Client-generated unique ID for idempotency. Required for retry safety. */
  requestId: Schema.String,
  topic: Schema.String,
  level: Schema.String,
  mode: Schema.String
}) {}

export class CreateRoomResponse extends Schema.Class<CreateRoomResponse>("CreateRoomResponse")({
  roomId: Schema.String,
  wsUrl: Schema.String,
  seedPrompt: Schema.String
}) {}

export class SubmitTurnResponse extends Schema.Class<SubmitTurnResponse>("SubmitTurnResponse")({
  turnId: Schema.String,
  status: Schema.String
}) {}

export class TurnAudioResponse extends Schema.Class<TurnAudioResponse>("TurnAudioResponse")({
  audioKey: Schema.String
}) {}

export class HttpErrorResponse extends Schema.Class<HttpErrorResponse>("HttpErrorResponse")({
  code: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean
}) {}

export class HttpTurnSubmission extends Schema.Class<HttpTurnSubmission>("HttpTurnSubmission")({
  roomId: Schema.String,
  turnId: Schema.optional(Schema.String),
  /** Client-generated unique ID for idempotency. Required for retry safety. */
  requestId: Schema.String,
  transcript: Schema.String,
  language: Schema.String,
  clientTimestamp: Schema.Number,
  audioFeatures: Schema.Struct({
    durationMs: Schema.Number,
    pauseCount: Schema.Number,
    speakingRateWpm: Schema.Number
  }),
  audioKey: Schema.optional(Schema.String),
  asrSource: Schema.optional(Schema.String)
}) {}

export const decodeCreateRoomRequest = Schema.decodeUnknownSync(CreateRoomRequest);
export const encodeCreateRoomRequest = Schema.encodeSync(CreateRoomRequest);
export const decodeCreateRoomResponse = Schema.decodeUnknownSync(CreateRoomResponse);
export const encodeCreateRoomResponse = Schema.encodeSync(CreateRoomResponse);
export const decodeSubmitTurnResponse = Schema.decodeUnknownSync(SubmitTurnResponse);
export const encodeSubmitTurnResponse = Schema.encodeSync(SubmitTurnResponse);
export const decodeTurnAudioResponse = Schema.decodeUnknownSync(TurnAudioResponse);
export const encodeTurnAudioResponse = Schema.encodeSync(TurnAudioResponse);
export const decodeHttpErrorResponse = Schema.decodeUnknownSync(HttpErrorResponse);
export const encodeHttpErrorResponse = Schema.encodeSync(HttpErrorResponse);
export const decodeHttpTurnSubmission = Schema.decodeUnknownSync(HttpTurnSubmission);
export const encodeHttpTurnSubmission = Schema.encodeSync(HttpTurnSubmission);
