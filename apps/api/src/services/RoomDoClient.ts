import { Context, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { Env } from "./Env";
import {
  RoomEventEnvelope,
  encodeRoomEventEnvelopeMsgPack,
  type RoomEvent
} from "../domain/RoomProtocol";

export class RoomDoClientError extends Schema.TaggedError<RoomDoClientError>()(
  "RoomDoClientError",
  { reason: Schema.String }
) {}

export interface RoomDoClientService {
  emitRoomEvent: (
    roomId: string,
    event: RoomEvent,
    stateJson?: string
  ) => Effect.Effect<void, RoomDoClientError, never>;
}

export class RoomDoClient extends Context.Tag("RoomDoClient")<
  RoomDoClient,
  RoomDoClientService
>() {}

const makeClient = Effect.gen(function* () {
  const env = yield* Env;
  return {
    emitRoomEvent: (roomId: string, event: RoomEvent, stateJson?: string) =>
      Effect.tryPromise({
        try: async () => {
          const namespace = env.ROOMS;
          const id =
            "idFromName" in namespace && typeof namespace.idFromName === "function"
              ? namespace.idFromName(roomId)
              : (roomId as unknown as DurableObjectId);
          const stub = namespace.get(id);
          const payload = encodeRoomEventEnvelopeMsgPack(
            new RoomEventEnvelope({
              roomId,
              event,
              stateJson
            })
          );
          const response = await stub.fetch("https://room/internal/event", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: payload as unknown as BodyInit
          });
          if (!response.ok) {
            throw new Error(`room_do_error:${response.status}`);
          }
        },
        catch: (cause) => new RoomDoClientError({ reason: String(cause) })
      })
  };
});

export const RoomDoClientLive = Layer.effect(RoomDoClient, makeClient);
