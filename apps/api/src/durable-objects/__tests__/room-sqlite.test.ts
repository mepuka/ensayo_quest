import { it, expect } from "bun:test";
import { applyRoomSchema, roomSchemaSql } from "../db/schema";
import { roomQueries } from "../db/queries";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Effect } from "effect";

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

it("applies the room schema at runtime", async () => {
  const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });
  const program = Effect.gen(function* () {
    const sql = yield* SqliteClient.SqliteClient;
    yield* applyRoomSchema;
    const rows = yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_state'`;
    return rows;
  });
  const rows = await Effect.runPromise(
    Effect.scoped(program.pipe(Effect.provide(sqliteLayer)))
  );
  expect(rows.length).toBe(1);
});
