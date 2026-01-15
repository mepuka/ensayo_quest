import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import * as EventLogServer from "@effect/experimental/EventLogServer";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { makeEventLogStorageLayer } from "../EventLogStorage";
import { appendRoomEvent, appendRoomEventWithState } from "../RoomEventAppender";
import { RoomSnapshot, encodeRoomEventMsgPack } from "../../domain/RoomProtocol";

it("appends room events as event log entries", async () => {
  const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });
  const storageLayer = Layer.provideMerge(sqliteLayer)(makeEventLogStorageLayer());
  const program = Effect.gen(function* () {
    const storage = yield* EventLogServer.Storage;
    const event = new RoomSnapshot({
      type: "RoomSnapshot",
      roomId: "room-1",
      scenarioId: "scenario-1",
      status: "playing",
      currentTurnIndex: 0,
      objectivesCompleted: 0,
      history: []
    });
    yield* appendRoomEvent("room-1", event);
    const entries = yield* storage.entries("room-1", 0);
    return { entries, encoded: encodeRoomEventMsgPack(event) };
  });
  const result = await Effect.runPromise(
    Effect.scoped(program.pipe(Effect.provide(storageLayer)))
  );
  const firstEntry = result.entries[0];
  if (!firstEntry) {
    throw new Error("expected event entries");
  }
  expect(result.entries.length).toBe(1);
  expect(firstEntry.encryptedEntry).toEqual(result.encoded);
});

it("updates room state when appending events", async () => {
  const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });
  const storageLayer = Layer.provideMerge(sqliteLayer)(makeEventLogStorageLayer());
  const program = Effect.gen(function* () {
    const sql = yield* SqliteClient.SqliteClient;
    yield* sql`CREATE TABLE IF NOT EXISTS room_state (room_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL)`.withoutTransform;
    const event = new RoomSnapshot({
      type: "RoomSnapshot",
      roomId: "room-2",
      scenarioId: "scenario-2",
      status: "playing",
      currentTurnIndex: 0,
      objectivesCompleted: 0,
      history: []
    });
    yield* appendRoomEventWithState("room-2", event, JSON.stringify({ status: "playing" }));
    const rows = yield* sql`SELECT state_json FROM room_state WHERE room_id = ${"room-2"}`;
    return rows;
  });
  const rows = await Effect.runPromise(
    Effect.scoped(program.pipe(Effect.provide(storageLayer)))
  );
  expect(rows.length).toBe(1);
});
