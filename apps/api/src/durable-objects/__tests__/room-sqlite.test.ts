import { it, expect } from "bun:test";
import { roomSchemaSql } from "../db/schema";
import { roomQueries } from "../db/queries";

it("defines the room state tables for DO sqlite", () => {
  expect(roomSchemaSql).toContain("CREATE TABLE IF NOT EXISTS room_state");
  expect(roomSchemaSql).toContain("CREATE TABLE IF NOT EXISTS room_turns");
  expect(roomSchemaSql).toContain("CREATE TABLE IF NOT EXISTS room_turn_scores");
  expect(roomSchemaSql).toContain("CREATE TABLE IF NOT EXISTS room_turn_prompts");
});

it("exposes core room queries", () => {
  expect(roomQueries.upsertRoomState).toContain("room_state");
  expect(roomQueries.insertTurn).toContain("room_turns");
  expect(roomQueries.upsertTurnScore).toContain("room_turn_scores");
  expect(roomQueries.upsertTurnPrompt).toContain("room_turn_prompts");
});
