import * as EventLogServer from "@effect/experimental/EventLogServer";
import { makeEntryId } from "@effect/experimental/EventJournal";
import { Effect } from "effect";
import * as SqlClient from "@effect/sql/SqlClient";
import { encodeRoomEventMsgPack, type RoomEvent } from "../domain/RoomProtocol";

export const appendRoomEvent = Effect.fn(function* (roomId: string, event: RoomEvent) {
    const storage = yield* EventLogServer.Storage;
    const payload = encodeRoomEventMsgPack(event);
    const entry = new EventLogServer.PersistedEntry({
      entryId: makeEntryId(),
      iv: new Uint8Array(12),
      encryptedEntry: payload
    });
    yield* storage.write(roomId, [entry]);
  });

export const appendRoomEventWithState = Effect.fn(function* (
  roomId: string,
  event: RoomEvent,
  stateJson?: string
) {
    const storage = yield* EventLogServer.Storage;
    const sql = yield* SqlClient.SqlClient;
    const payload = encodeRoomEventMsgPack(event);
    const entry = new EventLogServer.PersistedEntry({
      entryId: makeEntryId(),
      iv: new Uint8Array(12),
      encryptedEntry: payload
    });
    if (!stateJson) {
      yield* storage.write(roomId, [entry]);
      return;
    }
    yield* sql.withTransaction(
      Effect.all([
        storage.write(roomId, [entry]),
        sql`INSERT INTO room_state (room_id, state_json, updated_at) VALUES (${roomId}, ${stateJson}, ${Date.now()})
          ON CONFLICT(room_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`.withoutTransform
      ])
    );
  });
