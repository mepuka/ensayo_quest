import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import * as EventLogServer from "@effect/experimental/EventLogServer";
import { makeEntryId } from "@effect/experimental/EventJournal";
import { makeEventLogStorageLayer } from "../EventLogStorage";
import { SqliteClient } from "@effect/sql-sqlite-bun";

it("persists and reads event log entries", async () => {
  const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });
  const storageLayer = Layer.provideMerge(sqliteLayer)(makeEventLogStorageLayer());
  const program = Effect.gen(function* () {
    const storage = yield* EventLogServer.Storage;
    const entry = new EventLogServer.PersistedEntry({
      entryId: makeEntryId(),
      iv: new Uint8Array(12),
      encryptedEntry: new Uint8Array([1, 2, 3])
    });
    const written = yield* storage.write("room-1", [entry]);
    const entries = yield* storage.entries("room-1", 0);
    return { written, entries };
  });
  const result = await Effect.runPromise(
    Effect.scoped(program.pipe(Effect.provide(storageLayer)))
  );
  const firstWritten = result.written[0];
  const firstEntry = result.entries[0];
  if (!firstWritten || !firstEntry) {
    throw new Error("expected stored entries");
  }
  expect(result.written.length).toBe(1);
  expect(result.entries.length).toBe(1);
  expect(firstEntry.sequence).toBe(firstWritten.sequence);
  expect(firstEntry.sequence).toBeGreaterThanOrEqual(0);
});
