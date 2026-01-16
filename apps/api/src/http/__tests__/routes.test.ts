import { it, expect } from "bun:test";
import { routes, matchRoute } from "../routes";

it("exposes minimum API routes", () => {
  expect(Object.keys(routes)).toEqual([
    "createRoom",
    "submitTurn",
    "streamRoom",
    "uploadAudio"
  ]);
});

it("matches createRoom route", () => {
  const result = matchRoute("POST", ["api", "rooms"], routes.createRoom);
  expect(result).toEqual({});
});

it("matches submitTurn route with parameter", () => {
  const result = matchRoute("POST", ["api", "rooms", "room-123", "turns"], routes.submitTurn);
  expect(result).toEqual({ roomId: "room-123" });
});

it("matches streamRoom route with parameter", () => {
  const result = matchRoute("GET", ["api", "rooms", "room-456", "stream"], routes.streamRoom);
  expect(result).toEqual({ roomId: "room-456" });
});

it("matches uploadAudio route with parameter", () => {
  const result = matchRoute("POST", ["api", "turns", "turn-789", "audio"], routes.uploadAudio);
  expect(result).toEqual({ turnId: "turn-789" });
});

it("returns null for method mismatch", () => {
  const result = matchRoute("GET", ["api", "rooms"], routes.createRoom);
  expect(result).toBeNull();
});

it("returns null for path mismatch", () => {
  const result = matchRoute("POST", ["api", "other"], routes.createRoom);
  expect(result).toBeNull();
});

it("returns null for length mismatch", () => {
  const result = matchRoute("POST", ["api"], routes.createRoom);
  expect(result).toBeNull();
});
