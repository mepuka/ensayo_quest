import { it, expect } from "bun:test";
import {
  decodeRoomEventMsgPack,
  encodeRoomEventMsgPack,
  RoomHistoryEntry,
  RoomSnapshot
} from "../RoomProtocol";

it("round-trips RoomSnapshot over MsgPack", () => {
  const event = new RoomSnapshot({
    type: "RoomSnapshot",
    roomId: "room-1",
    scenarioId: "scenario-1",
    status: "playing",
    currentTurnIndex: 2,
    objectivesCompleted: 1,
    history: [
      new RoomHistoryEntry({
        turnId: "turn-1",
        role: "user",
        text: "hola"
      })
    ]
  });
  const encoded = encodeRoomEventMsgPack(event);
  const decoded = decodeRoomEventMsgPack(encoded);
  expect(decoded.type).toBe("RoomSnapshot");
  if (decoded.type === "RoomSnapshot") {
    expect(decoded.roomId).toBe("room-1");
    expect(decoded.history.length).toBe(1);
  }
});
