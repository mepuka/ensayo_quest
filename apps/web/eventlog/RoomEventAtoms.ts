import { Atom } from "@effect-atom/atom-react";
import { Effect, Stream } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { RoomEvent } from "../../shared/src/RoomProtocol";
import { getRoomStreamUrl, makeRoomEventStream } from "./EventLogClient";
import { initialScorePanelState, reduceRoomEvent, type ScorePanelState } from "./RoomEventReducer";

export const roomIdAtom = Atom.searchParam("roomId", { schema: Schema.String });

export const scorePanelStreamFromEvents = (
  events: Stream.Stream<RoomEvent>,
  initial: ScorePanelState
) => Stream.scan(events, initial, reduceRoomEvent);

const roomEventStreamForId = (roomId: string) =>
  makeRoomEventStream({ roomId, url: getRoomStreamUrl(roomId) }).pipe(
    Stream.tap((event) => Effect.sync(() => console.info("RoomEvent", event)))
  );

export const roomEventsAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  if (Option.isNone(roomId) || roomId.value.trim() === "") {
    return Stream.empty;
  }
  return roomEventStreamForId(roomId.value);
});

export const scorePanelAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  const initial = initialScorePanelState("unknown");
  if (Option.isNone(roomId) || roomId.value.trim() === "") {
    return Stream.make(initial);
  }
  return scorePanelStreamFromEvents(roomEventStreamForId(roomId.value), initial);
});
