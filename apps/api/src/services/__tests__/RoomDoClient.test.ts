import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { Env } from "../Env";
import { RoomDoClient, RoomDoClientLive } from "../RoomDoClient";
import { RoomSnapshot, decodeRoomEventEnvelopeMsgPack } from "../../domain/RoomProtocol";

it("sends room events to the DO endpoint", async () => {
  let received: Uint8Array | null = null;
  const stub = {
    fetch: async (input: RequestInfo, init?: RequestInit) => {
      if (init?.body instanceof Uint8Array) {
        received = init.body;
      }
      return new Response(null, { status: 204 });
    }
  };
  const envLayer = Layer.succeed(Env, {
    DB: {} as D1Database,
    AUDIO_BUCKET: {} as R2Bucket,
    SPANISH_VECTORS: {} as VectorizeIndex,
    TURN_QUEUE: {} as Queue,
    ROOMS: {
      get: () => stub
    } as unknown as DurableObjectNamespace,
    AI: {}
  });
  const event = new RoomSnapshot({
    type: "RoomSnapshot",
    roomId: "room-1",
    scenarioId: "scenario-1",
    status: "playing",
    currentTurnIndex: 0,
    objectivesCompleted: 0,
    history: []
  });
  const program = Effect.gen(function* () {
    const client = yield* RoomDoClient;
    yield* client.emitRoomEvent("room-1", event);
  });
  const layer = Layer.provideMerge(envLayer)(RoomDoClientLive);
  await Effect.runPromise(program.pipe(Effect.provide(layer)));
  if (!received) {
    throw new Error("expected event payload");
  }
  const decoded = decodeRoomEventEnvelopeMsgPack(received);
  expect(decoded.event.type).toBe("RoomSnapshot");
});
