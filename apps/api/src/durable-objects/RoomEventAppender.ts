import { EventLogEncryption } from "@effect/experimental/EventLogEncryption";
import { Identity } from "@effect/experimental/EventLog";
import * as EventLogServer from "@effect/experimental/EventLogServer";
import { Entry, makeEntryId } from "@effect/experimental/EventJournal";
import { Effect } from "effect";
import * as SqlClient from "@effect/sql/SqlClient";
import * as Redacted from "effect/Redacted";
import { encodeRoomEventMsgPack, type RoomEvent } from "../domain/RoomProtocol";

export const makeRoomIdentity = Effect.fn("RoomEventAppender.makeRoomIdentity")(function* (roomId: string) {
  const encryption = yield* EventLogEncryption;
  const key = yield* encryption.sha256(new TextEncoder().encode(roomId));
  return Identity.of({
    publicKey: roomId,
    privateKey: Redacted.make(key)
  });
});

export const appendRoomEvent = Effect.fn("RoomEventAppender.appendRoomEvent")(function* (roomId: string, event: RoomEvent) {
    const storage = yield* EventLogServer.Storage;
    const encryption = yield* EventLogEncryption;
    const identity = yield* makeRoomIdentity(roomId);
    const payload = encodeRoomEventMsgPack(event);
    const entry = new Entry({
      id: makeEntryId(),
      event: event.type,
      primaryKey: roomId,
      payload
    });
    const encrypted = yield* encryption.encrypt(identity, [entry]);
    const persisted = encrypted.encryptedEntries.map(
      (encryptedEntry) =>
        new EventLogServer.PersistedEntry({
          entryId: entry.id,
          iv: encrypted.iv,
          encryptedEntry
        })
    );
    yield* storage.write(identity.publicKey, persisted);
  });

export const appendRoomEventWithState = Effect.fn("RoomEventAppender.appendRoomEventWithState")(function* (
  roomId: string,
  event: RoomEvent,
  stateJson?: string
) {
    const storage = yield* EventLogServer.Storage;
    const encryption = yield* EventLogEncryption;
    const identity = yield* makeRoomIdentity(roomId);
    const sql = yield* SqlClient.SqlClient;
    const payload = encodeRoomEventMsgPack(event);
    const entry = new Entry({
      id: makeEntryId(),
      event: event.type,
      primaryKey: roomId,
      payload
    });
    const encrypted = yield* encryption.encrypt(identity, [entry]);
    const persisted = encrypted.encryptedEntries.map(
      (encryptedEntry) =>
        new EventLogServer.PersistedEntry({
          entryId: entry.id,
          iv: encrypted.iv,
          encryptedEntry
        })
    );
    if (!stateJson) {
      yield* storage.write(identity.publicKey, persisted);
      return;
    }
    yield* sql.withTransaction(
      Effect.all([
        storage.write(identity.publicKey, persisted),
        sql`INSERT INTO room_state (room_id, state_json, updated_at) VALUES (${roomId}, ${stateJson}, ${Date.now()})
          ON CONFLICT(room_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`.withoutTransform
      ])
    );
  });
