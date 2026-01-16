import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import type { MessageBatch, ExecutionContext } from "@cloudflare/workers-types";
import { encodeJson } from "./http/codec";
import { handlers } from "./http/handlers";
import { CreateRoomRequest, CreateRoomResponse, SubmitTurnResponse, TurnAudioResponse } from "./domain/HttpProtocol";
import type { CloudflareEnv } from "./services/Env";
import { Env } from "./services/Env";
import { DbLive } from "./services/Db";
import { TurnQueueLive } from "./services/TurnQueue";
import { RoomDoClientLive } from "./services/RoomDoClient";
import { RoomIdGeneratorLive } from "./services/RoomIdGenerator";
import { TurnstileLive } from "./security/Turnstile";
import { ScoringConfigLive, ScoringServiceLive } from "./services/ScoringService";
import { AudioBucketLive } from "./services/CloudflareLayers";
import { LanguageReviewGoogleLive } from "./services/LanguageReviewGoogle";
import { makeTurnScoringConsumer } from "./workers/TurnScoringConsumer";
import { Db } from "./services/Db";
import { RoomDurableObject } from "./durable-objects/RoomDurableObject";
import { toHttpErrorResponse } from "./http/errorResponse";
import { routes, matchRoute } from "./http/routes";

class RequestReadError extends Schema.TaggedError<RequestReadError>()("RequestReadError", {
  reason: Schema.String
}) {}

// ============================================================================
// CORS Configuration - centralized for easy modification
// ============================================================================
const corsConfig = {
  allowedOrigins: "*",
  allowedMethods: "GET, POST, PUT, DELETE, OPTIONS",
  allowedHeaders: "Content-Type, Authorization",
  maxAge: "86400"
} as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": corsConfig.allowedOrigins,
  "Access-Control-Allow-Methods": corsConfig.allowedMethods,
  "Access-Control-Allow-Headers": corsConfig.allowedHeaders,
  "Access-Control-Max-Age": corsConfig.maxAge
};

// Apply CORS headers to any response - single point of CORS application
const withCors = (response: Response): Response => {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

// Handle CORS preflight - returns early if this is an OPTIONS request
const handleCorsPreflight = (method: string): Response | null => {
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
};

// ============================================================================
// Application Layer
// ============================================================================
const makeAppLayer = (env: CloudflareEnv) => {
  const envLayer = Layer.succeed(Env, env);
  const baseLayer = Layer.mergeAll(
    DbLive,
    TurnQueueLive,
    RoomDoClientLive,
    RoomIdGeneratorLive,
    TurnstileLive,
    AudioBucketLive,
    LanguageReviewGoogleLive
  ).pipe(Layer.provideMerge(envLayer));
  const scoringLayer = ScoringServiceLive.pipe(Layer.provideMerge(ScoringConfigLive));
  return Layer.mergeAll(baseLayer, scoringLayer);
};

// ============================================================================
// Request Helpers
// ============================================================================
const decodeBody = <A, I>(schema: Schema.Schema<A, I>, request: Request) =>
  Effect.tryPromise({
    try: () => request.text(),
    catch: (cause) => new RequestReadError({ reason: String(cause) })
  }).pipe(
    Effect.flatMap((text) => Schema.decodeUnknown(Schema.parseJson(schema))(text))
  );

const decodeUnknownBody = (request: Request) =>
  Effect.tryPromise({
    try: () => request.text(),
    catch: (cause) => new RequestReadError({ reason: String(cause) })
  }).pipe(Effect.flatMap((text) => Schema.decodeUnknown(Schema.parseJson())(text)));

const jsonResponse = <A, I>(schema: Schema.Schema<A, I>, value: A, status = 200) =>
  new Response(encodeJson(schema, value), {
    status,
    headers: { "Content-Type": "application/json" }
  });

const wsUrlForRoom = (request: Request, roomId: string) => {
  const url = new URL(request.url);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}/api/rooms/${roomId}/stream`;
};

const getRoomStub = (env: CloudflareEnv, roomId: string) => {
  const namespace = env.ROOMS;
  const id =
    "idFromName" in namespace && typeof namespace.idFromName === "function"
      ? namespace.idFromName(roomId)
      : (roomId as unknown as DurableObjectId);
  return namespace.get(id);
};

// ============================================================================
// Exports
// ============================================================================
export { RoomDurableObject };

// ============================================================================
// Queue Retry Backoff
// ============================================================================

/**
 * Calculate exponential backoff delay for queue retries.
 * Base: 30 seconds, multiplier: 3x per attempt
 * Max: 12 hours (43200 seconds)
 *
 * Attempts: 1 → 30s, 2 → 90s, 3 → 270s, 4 → 810s, 5+ → capped at 12h
 */
const calculateRetryDelay = (attempts: number): number => {
  const baseDelay = 30;
  const multiplier = 3;
  const maxDelay = 43200; // 12 hours
  const delay = baseDelay * Math.pow(multiplier, Math.max(0, attempts - 1));
  return Math.min(delay, maxDelay);
};

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    // ctx.waitUntil() available for background work after response is sent
    // Usage: ctx.waitUntil(Effect.runPromise(backgroundEffect))
    void ctx; // Mark as intentionally unused until needed

    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const method = request.method.toUpperCase();

    // Handle CORS preflight - early return
    const preflightResponse = handleCorsPreflight(method);
    if (preflightResponse) return preflightResponse;

    const appLayer = makeAppLayer(env);

    const program = Effect.gen(function* () {
      // Route: POST /api/rooms
      const createRoomParams = matchRoute(method, segments, routes.createRoom);
      if (createRoomParams) {
        const input = yield* decodeBody(CreateRoomRequest, request);
        const created = yield* handlers.createRoom(input);
        return jsonResponse(CreateRoomResponse, new CreateRoomResponse({
          roomId: created.roomId,
          wsUrl: wsUrlForRoom(request, created.roomId),
          seedPrompt: created.seedPrompt
        }), 201);
      }

      // Route: POST /api/rooms/:roomId/turns
      const submitTurnParams = matchRoute(method, segments, routes.submitTurn);
      if (submitTurnParams) {
        const roomId = submitTurnParams.roomId ?? "";
        if (!roomId) return new Response("Not Found", { status: 404 });
        const body = yield* decodeUnknownBody(request);
        const result = yield* handlers.submitTurn(roomId, body);
        return jsonResponse(SubmitTurnResponse, result, 202);
      }

      // Route: GET /api/rooms/:roomId/stream (WebSocket - delegate to Durable Object)
      const streamParams = matchRoute(method, segments, routes.streamRoom);
      if (streamParams) {
        const roomId = streamParams.roomId ?? "";
        if (!roomId) return new Response("Not Found", { status: 404 });
        const stub = getRoomStub(env, roomId);
        return yield* Effect.tryPromise({
          try: () => stub.fetch(request),
          catch: (cause) => new RequestReadError({ reason: String(cause) })
        });
      }

      // Route: POST /api/turns/:turnId/audio
      // Requires headers: X-Room-Id, X-Request-Id
      const uploadAudioParams = matchRoute(method, segments, routes.uploadAudio);
      if (uploadAudioParams) {
        const turnId = uploadAudioParams.turnId ?? "";
        const roomId = request.headers.get("X-Room-Id") ?? "";
        const requestId = request.headers.get("X-Request-Id") ?? crypto.randomUUID();
        if (!turnId) return new Response("Not Found", { status: 404 });
        if (!roomId) return new Response("Missing X-Room-Id header", { status: 400 });
        const audio = yield* Effect.tryPromise({
          try: () => request.arrayBuffer(),
          catch: (cause) => new RequestReadError({ reason: String(cause) })
        });
        const contentType = request.headers.get("Content-Type") ?? undefined;
        const result = yield* handlers.uploadTurnAudio({
          turnId,
          roomId,
          requestId,
          audio,
          ...(contentType ? { contentType } : {})
        });
        return jsonResponse(TurnAudioResponse, result, 201);
      }

      // No route matched
      return new Response("Not Found", { status: 404 });
    }).pipe(
      Effect.provide(appLayer),
      Effect.catchAll((error) => Effect.succeed(toHttpErrorResponse(error)))
    );

    // Run the effect and apply CORS to the response (single boundary point)
    const response = await Effect.runPromise(program);
    return withCors(response);
  },

  async queue(batch: MessageBatch, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
    void ctx; // Available for background work if needed
    const appLayer = makeAppLayer(env);
    const program = Effect.gen(function* () {
      const db = yield* Db;
      const consumer = yield* makeTurnScoringConsumer;

      yield* Effect.forEach(batch.messages, (message) =>
        Effect.fn("queue.processMessage")(function* () {
          // Idempotency check: skip if already processed
          const alreadyProcessed = yield* db.isMessageProcessed(message.id).pipe(
            Effect.catchAll(() => Effect.succeed(false))
          );
          if (alreadyProcessed) {
            message.ack();
            return;
          }

          // Process the message
          yield* consumer.handle(message.body);

          // Mark as processed before ack (idempotency record)
          yield* db.markMessageProcessed(message.id).pipe(
            Effect.catchAll(() => Effect.void)
          );
          message.ack();
        })().pipe(
          // Retryable errors: retry with exponential backoff
          Effect.catchTag("TurnScoringRetryableError", (err) =>
            Effect.sync(() => {
              const delay = calculateRetryDelay(message.attempts);
              console.error(
                `Retryable error for message ${message.id} (attempt ${message.attempts}, retry in ${delay}s): ${err.reason}`
              );
              message.retry({ delaySeconds: delay });
            })
          ),
          // Non-retryable errors: ack to prevent retry (let DLQ handle via max_retries)
          Effect.catchTag("TurnScoringNonRetryableError", (err) =>
            Effect.sync(() => {
              console.error(`Non-retryable error for message ${message.id}: ${err.reason}`);
              message.ack(); // Don't retry - permanent failure
            })
          )
        )
      );
    }).pipe(Effect.provide(appLayer));
    await Effect.runPromise(program);
  }
};
