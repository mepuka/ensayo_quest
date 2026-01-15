import { Effect, Layer, Stream } from "effect";
import * as Redacted from "effect/Redacted";
import * as EventLog from "@effect/experimental/EventLog";
import * as EventLogEncryption from "@effect/experimental/EventLogEncryption";
import * as EventLogRemote from "@effect/experimental/EventLogRemote";
import * as EventJournal from "@effect/experimental/EventJournal";
import * as Socket from "@effect/platform/Socket";
import { decodeRoomEventMsgPack, type RoomEvent } from "../../shared/src/RoomProtocol";

export const makeRoomIdentity = Effect.fn(function* (roomId: string) {
  const encryption = yield* EventLogEncryption.EventLogEncryption;
  const key = yield* encryption.sha256(new TextEncoder().encode(roomId));
  return EventLog.Identity.of({
    publicKey: roomId,
    privateKey: Redacted.make(key)
  });
});

export const buildRoomStreamUrl = (baseUrl: string, roomId: string) => {
  const url = new URL(baseUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}/api/rooms/${roomId}/stream`;
};

export const getRoomStreamUrl = (roomId: string) => buildRoomStreamUrl(window.location.href, roomId);

export const decodeRoomEventEntry = (entry: EventJournal.Entry): RoomEvent =>
  decodeRoomEventMsgPack(entry.payload);

export const roomEventStreamFromEntries = (
  entries: Stream.Stream<EventJournal.Entry>
): Stream.Stream<RoomEvent> => Stream.map(entries, decodeRoomEventEntry);

const makeRoomEventLayer = (roomId: string, url: string) => {
  const identityLayer = Layer.effect(EventLog.Identity, makeRoomIdentity(roomId)).pipe(
    Layer.provideMerge(EventLogEncryption.layerSubtle)
  );
  const base = Layer.mergeAll(
    EventJournal.layerMemory,
    Socket.layerWebSocketConstructorGlobal,
    identityLayer
  );
  const eventLogLayer = EventLog.layerEventLog.pipe(Layer.provideMerge(base));
  return EventLogRemote.layerWebSocket(url).pipe(Layer.provideMerge(eventLogLayer));
};

export const makeRoomEventStream = (options: { roomId: string; url: string }) =>
  Stream.unwrapScoped(
    Effect.gen(function* () {
      const journal = yield* EventJournal.EventJournal;
      const changes = yield* journal.changes;
      return roomEventStreamFromEntries(Stream.fromQueue(changes));
    })
  ).pipe(Stream.provideLayer(makeRoomEventLayer(options.roomId, options.url)));
