import { Context, Effect, Layer } from "effect";

export interface RoomIdGeneratorService {
  generate: Effect.Effect<string, never, never>;
}

export class RoomIdGenerator extends Context.Tag("RoomIdGenerator")<
  RoomIdGenerator,
  RoomIdGeneratorService
>() {}

export const RoomIdGeneratorLive = Layer.succeed(RoomIdGenerator, {
  generate: Effect.sync(() => crypto.randomUUID())
});
