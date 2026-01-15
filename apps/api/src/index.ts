import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import type { MessageBatch } from "@cloudflare/workers-types";
import { encodeJson } from "./http/codec";
import { handlers } from "./http/handlers";
import { CreateRoomRequest, CreateRoomResponse, TurnAudioResponse } from "./domain/HttpProtocol";
import type { CloudflareEnv } from "./services/Env";
import { Env } from "./services/Env";
import { DbLive } from "./services/Db";
import { TurnQueueLive } from "./services/TurnQueue";
import { RoomDoClientLive } from "./services/RoomDoClient";
import { RoomIdGeneratorLive } from "./services/RoomIdGenerator";
import { TurnstileLive } from "./security/Turnstile";
import { ScoringConfigLive, ScoringServiceLive } from "./services/ScoringService";
import { AudioBucketLive } from "./services/CloudflareLayers";
import { makeTurnScoringConsumer } from "./workers/TurnScoringConsumer";
import { RoomDurableObject } from "./durable-objects/RoomDurableObject";
import { toHttpErrorResponse } from "./http/errorResponse";

const SubmitTurnResponse = Schema.Struct({
  turnId: Schema.String,
  status: Schema.String
});

class RequestReadError extends Schema.TaggedError<RequestReadError>()("RequestReadError", {
  reason: Schema.String
}) {}

const makeAppLayer = (env: CloudflareEnv) => {
  const envLayer = Layer.succeed(Env, env);
  const baseLayer = Layer.mergeAll(
    DbLive,
    TurnQueueLive,
    RoomDoClientLive,
    RoomIdGeneratorLive,
    TurnstileLive,
    AudioBucketLive
  ).pipe(Layer.provideMerge(envLayer));
  const scoringLayer = ScoringServiceLive.pipe(Layer.provideMerge(ScoringConfigLive));
  return Layer.mergeAll(baseLayer, scoringLayer);
};

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

const errorResponse = (error: unknown) => toHttpErrorResponse(error);

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

export { RoomDurableObject };

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const method = request.method.toUpperCase();
    const appLayer = makeAppLayer(env);
    const program = Effect.gen(function* () {
      if (method === "POST" && segments.length === 2 && segments[0] === "api" && segments[1] === "rooms") {
        const input = yield* decodeBody(CreateRoomRequest, request);
        const created = yield* handlers.createRoom(input);
        const response = new CreateRoomResponse({
          roomId: created.roomId,
          wsUrl: wsUrlForRoom(request, created.roomId),
          seedPrompt: created.seedPrompt
        });
        return jsonResponse(CreateRoomResponse, response, 201);
      }
      if (
        method === "POST" &&
        segments.length === 4 &&
        segments[0] === "api" &&
        segments[1] === "rooms" &&
        segments[3] === "turns"
      ) {
        const roomId = segments[2] ?? "";
        if (!roomId) {
          return new Response("Not Found", { status: 404 });
        }
        const body = yield* decodeUnknownBody(request);
        const result = yield* handlers.submitTurn(roomId, body);
        return jsonResponse(SubmitTurnResponse, result, 202);
      }
      if (
        method === "GET" &&
        segments.length === 4 &&
        segments[0] === "api" &&
        segments[1] === "rooms" &&
        segments[3] === "stream"
      ) {
        const roomId = segments[2] ?? "";
        if (!roomId) {
          return new Response("Not Found", { status: 404 });
        }
        const stub = getRoomStub(env, roomId);
        return yield* Effect.tryPromise({
          try: () => stub.fetch(request),
          catch: (cause) => new RequestReadError({ reason: String(cause) })
        });
      }
      if (
        method === "POST" &&
        segments.length === 4 &&
        segments[0] === "api" &&
        segments[1] === "turns" &&
        segments[3] === "audio"
      ) {
        const turnId = segments[2] ?? "";
        if (!turnId) {
          return new Response("Not Found", { status: 404 });
        }
        const audio = yield* Effect.tryPromise({
          try: () => request.arrayBuffer(),
          catch: (cause) => new RequestReadError({ reason: String(cause) })
        });
        const contentType = request.headers.get("Content-Type") ?? undefined;
        const result = yield* handlers.uploadTurnAudio({
          turnId,
          audio,
          ...(contentType ? { contentType } : {})
        });
        return jsonResponse(TurnAudioResponse, result, 201);
      }
      return new Response("Not Found", { status: 404 });
    }).pipe(
      Effect.provide(appLayer),
      Effect.catchAll((error) => Effect.succeed(errorResponse(error)))
    );
    return Effect.runPromise(program);
  },
  async queue(batch: MessageBatch, env: CloudflareEnv): Promise<void> {
    const appLayer = makeAppLayer(env);
    const program = Effect.gen(function* () {
      const consumer = yield* makeTurnScoringConsumer;
      yield* Effect.forEach(batch.messages, (message) =>
        consumer.handle(message.body).pipe(
          Effect.tap(() => Effect.sync(() => message.ack())),
          Effect.catchAll(() =>
            Effect.sync(() => {
              message.retry();
            })
          )
        )
      );
    }).pipe(Effect.provide(appLayer));
    await Effect.runPromise(program);
  }
};
