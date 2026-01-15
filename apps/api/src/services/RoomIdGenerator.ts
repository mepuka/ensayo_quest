import { Context, Effect } from "effect";

export interface RoomIdGeneratorService {
  generate: Effect.Effect<string, never, never>;
}

export class RoomIdGenerator extends Context.Tag("RoomIdGenerator")<
  RoomIdGenerator,
  RoomIdGeneratorService
>() {}

export const RoomIdGeneratorLive = RoomIdGenerator.of({
  generate: Effect.sync(() => crypto.randomUUID())
});
