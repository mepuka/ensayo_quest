import { describe, expect, it, beforeEach } from "bun:test";
import { Effect, Layer, Stream, Chunk } from "effect";
import * as Redacted from "effect/Redacted";
import * as EventLogEncryption from "@effect/experimental/EventLogEncryption";
import { Entry, makeEntryId } from "@effect/experimental/EventJournal";
import { payloadEncoders, type RoomEvent } from "../../shared/src/RoomProtocol";
import {
  buildRoomStreamUrl,
  decodeRoomEventEntry,
  makeRoomIdentity,
  roomEventStreamFromEntries,
  getOrCreateRoomConnection,
  clearAllRoomConnections
} from "../eventlog/EventLogClient";

// Server payload format (matches what the server writes to journal)
const scorePayload = {
  roomId: "room-1",
  turnId: "turn-1",
  scores: {
    fluency: 0.7,
    vocab: 0.6,
    naturalness: 0.8
  },
  overallScore: 0.7,
  feedback: ["Good flow"],
  nextPrompt: "Continue the conversation."
};

// Expected RoomEvent after decoding (what the client sees)
const expectedScoreEvent: RoomEvent = {
  type: "ScoreUpdated",
  turnId: "turn-1",
  evaluation: {
    turnId: "turn-1",
    scores: {
      fluency: 0.7,
      vocab: 0.6,
      naturalness: 0.8
    },
    overallScore: 0.7,
    feedback: ["Good flow"],
    nextPrompt: "Continue the conversation.",
    modelVersion: "unknown", // Default value from decoder
    confidence: 1.0 // Default value from decoder
  }
};

describe("buildRoomStreamUrl", () => {
  it("builds a ws url from http", () => {
    const url = buildRoomStreamUrl("http://localhost:8787/app", "room-1");
    expect(url).toBe("ws://localhost:8787/api/rooms/room-1/stream");
  });

  it("builds a wss url from https", () => {
    const url = buildRoomStreamUrl("https://example.com/app", "room-1");
    expect(url).toBe("wss://example.com/api/rooms/room-1/stream");
  });
});

describe("makeRoomIdentity", () => {
  it("derives deterministic keys from roomId", async () => {
    const program = Effect.gen(function* () {
      const first = yield* makeRoomIdentity("room-1");
      const second = yield* makeRoomIdentity("room-1");
      return {
        first: Redacted.value(first.privateKey),
        second: Redacted.value(second.privateKey),
        publicKey: first.publicKey
      };
    }).pipe(Effect.provide(Layer.mergeAll(EventLogEncryption.layerSubtle)));

    const result = await Effect.runPromise(program);
    expect(result.publicKey).toBe("room-1");
    expect(Array.from(result.first)).toEqual(Array.from(result.second));
  });
});

describe("decodeRoomEventEntry", () => {
  it("decodes entry payloads to RoomEvent", () => {
    // Use server payload format (without type field, flat structure)
    const payload = payloadEncoders.ScoreUpdated(scorePayload);
    const entry = new Entry({
      id: makeEntryId(),
      event: "ScoreUpdated", // Server stores event type separately
      primaryKey: "room-1",
      payload
    });
    const decoded = decodeRoomEventEntry(entry);

    expect(decoded).toEqual(expectedScoreEvent);
  });
});

describe("roomEventStreamFromEntries", () => {
  it("maps entry streams to RoomEvent streams", async () => {
    // Use server payload format (without type field, flat structure)
    const payload = payloadEncoders.ScoreUpdated(scorePayload);
    const entry = new Entry({
      id: makeEntryId(),
      event: "ScoreUpdated", // Server stores event type separately
      primaryKey: "room-1",
      payload
    });
    const stream = roomEventStreamFromEntries(Stream.make(entry));
    const result = await Effect.runPromise(Stream.runCollect(stream));

    expect(Chunk.toReadonlyArray(result)).toEqual([expectedScoreEvent]);
  });
});

describe("getOrCreateRoomConnection", () => {
  beforeEach(() => {
    clearAllRoomConnections();
    // Mock window.location for tests
    (globalThis as any).window = {
      location: { href: "http://localhost:8787/app" }
    };
  });

  it("returns the same connection for the same roomId", () => {
    const conn1 = getOrCreateRoomConnection("test-room");
    const conn2 = getOrCreateRoomConnection("test-room");

    // Same reference means same connection (no duplicate WebSocket)
    expect(conn1).toBe(conn2);
    expect(conn1.statusRef).toBe(conn2.statusRef);
    expect(conn1.layer).toBe(conn2.layer);
  });

  it("returns different connections for different roomIds", () => {
    const conn1 = getOrCreateRoomConnection("room-a");
    const conn2 = getOrCreateRoomConnection("room-b");

    expect(conn1).not.toBe(conn2);
    expect(conn1.roomId).toBe("room-a");
    expect(conn2.roomId).toBe("room-b");
  });

  it("creates new connection after cache is cleared", () => {
    const conn1 = getOrCreateRoomConnection("test-room");
    clearAllRoomConnections();
    const conn2 = getOrCreateRoomConnection("test-room");

    // New connection created
    expect(conn1).not.toBe(conn2);
  });
});
