import * as EventLogServer from "@effect/experimental/EventLogServer";
import { Effect } from "effect";

export const makeRoomEventLogHandler = Effect.fn("RoomEventLog.makeHandler")(function* () {
    const handler = yield* EventLogServer.makeHandler;
    return handler;
  });
