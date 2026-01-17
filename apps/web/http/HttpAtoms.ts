/**
 * HTTP Operation Atoms
 *
 * Effect-native HTTP operations using Atom.fn for reactive state management.
 * Each operation tracks loading/error states via Result type.
 *
 * Uses @effect/platform HttpClient via Atom.runtime for proper Effect integration.
 *
 * @see docs/ARCHITECTURE.md - Invariant #2: All commands are idempotent via requestId
 */
import { Atom } from "@effect-atom/atom-react";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as FetchHttpClient from "@effect/platform/FetchHttpClient";

// =============================================================================
// HTTP Runtime (provides FetchHttpClient layer)
// =============================================================================

/**
 * AtomRuntime with FetchHttpClient layer.
 * All HTTP atoms should use this runtime to have access to HttpClient.
 */
const httpRuntime = Atom.runtime(FetchHttpClient.layer);

// =============================================================================
// Response Schemas
// =============================================================================

const CreateRoomResponse = Schema.Struct({
  roomId: Schema.String,
  wsUrl: Schema.optional(Schema.String),
  seedPrompt: Schema.String
});

const SubmitTurnResponse = Schema.Struct({
  turnId: Schema.String,
  status: Schema.String
});

const TurnAudioResponse = Schema.Struct({
  audioKey: Schema.String,
  status: Schema.optional(Schema.String)
});

// =============================================================================
// Input Types
// =============================================================================

export type CreateRoomInput = {
  requestId: string;
  topic: string;
  level: string;
  mode: string;
};

export type SubmitTurnInput = {
  roomId: string;
  requestId: string;
  transcript: string;
  language: string;
  clientTimestamp: number;
  audioFeatures: {
    durationMs: number;
    pauseCount: number;
    speakingRateWpm: number;
  };
  asrSource?: string;
};

export type UploadAudioInput = {
  turnId: string;
  roomId: string;
  requestId: string;
  audio: ArrayBuffer;
  contentType?: string;
};

// =============================================================================
// Output Types
// =============================================================================

export type CreateRoomResult = Schema.Schema.Type<typeof CreateRoomResponse>;
export type SubmitTurnResult = Schema.Schema.Type<typeof SubmitTurnResponse>;
export type UploadAudioResult = Schema.Schema.Type<typeof TurnAudioResponse>;

// =============================================================================
// HTTP Atoms
// =============================================================================

/**
 * Create a room with idempotency support.
 *
 * On success, updates URL params via pushstate for Atom.searchParam to detect.
 *
 * @see docs/ARCHITECTURE.md - Invariant #10: Room creation idempotent via requestId
 */
export const createRoomFn = httpRuntime.fn<CreateRoomInput>()(
  Effect.fnUntraced(function* (input: CreateRoomInput) {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

    const request = HttpClientRequest.post("/api/rooms").pipe(
      HttpClientRequest.setHeader("Content-Type", "application/json"),
      HttpClientRequest.bodyText(JSON.stringify(input))
    );

    const response = yield* client.execute(request);
    const data = yield* HttpClientResponse.schemaBodyJson(CreateRoomResponse)(response);

    // Update URL param - dispatch pushstate event for Atom.searchParam to detect
    const url = new URL(window.location.href);
    url.searchParams.set("roomId", data.roomId);
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new Event("pushstate"));

    return data;
  })
);

/**
 * Submit a turn for processing.
 *
 * Requires requestId for idempotency - generate UUID when ASR stops.
 *
 * @see docs/ARCHITECTURE.md - Invariant #2: All commands are idempotent via requestId
 */
export const submitTurnFn = httpRuntime.fn<SubmitTurnInput>()(
  Effect.fnUntraced(function* (input: SubmitTurnInput) {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

    const request = HttpClientRequest.post(`/api/rooms/${input.roomId}/turns`).pipe(
      HttpClientRequest.setHeader("Content-Type", "application/json"),
      HttpClientRequest.bodyText(JSON.stringify(input))
    );

    const response = yield* client.execute(request);
    return yield* HttpClientResponse.schemaBodyJson(SubmitTurnResponse)(response);
  })
);

/**
 * Upload audio for a turn.
 *
 * Requires X-Room-Id and X-Request-Id headers for validation and idempotency.
 *
 * @see docs/ARCHITECTURE.md - Invariant #2: All commands are idempotent via requestId
 * @see docs/ARCHITECTURE.md - Invariant #9: Scoring enqueue gated on AudioUploaded
 */
export const uploadAudioFn = httpRuntime.fn<UploadAudioInput>()(
  Effect.fnUntraced(function* (input: UploadAudioInput) {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

    const request = HttpClientRequest.post(`/api/turns/${input.turnId}/audio`).pipe(
      HttpClientRequest.setHeader("Content-Type", input.contentType ?? "audio/wav"),
      HttpClientRequest.setHeader("X-Room-Id", input.roomId),
      HttpClientRequest.setHeader("X-Request-Id", input.requestId),
      HttpClientRequest.bodyUint8Array(new Uint8Array(input.audio))
    );

    const response = yield* client.execute(request);
    return yield* HttpClientResponse.schemaBodyJson(TurnAudioResponse)(response);
  })
);
