import { it, expect } from "bun:test";
import { toRoomErrorEvent, WsInvalidEvent } from "../ProtocolErrors";

it("maps protocol errors to RoomError events", () => {
  const error = new WsInvalidEvent({ reason: "unknown_type" });
  const event = toRoomErrorEvent(error);
  expect(event.type).toBe("Error");
  expect(event.code).toBe("ws_invalid_event");
});
