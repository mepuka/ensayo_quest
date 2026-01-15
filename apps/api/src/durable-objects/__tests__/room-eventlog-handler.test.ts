import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { makeRoomEventLogHandler } from "../RoomEventLog";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { makeEventLogStorageLayer } from "../EventLogStorage";

it("builds a room event log handler", async () => {
  const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });
  const storageLayer = Layer.provideMerge(sqliteLayer)(makeEventLogStorageLayer());
  const handler = await Effect.runPromise(
    Effect.scoped(makeRoomEventLogHandler().pipe(Effect.provide(storageLayer)))
  );
  expect(typeof handler).toBe("function");
});
