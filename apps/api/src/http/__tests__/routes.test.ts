import { it, expect } from "bun:test";
import { routes } from "../routes";

it("exposes minimum API routes", () => {
  expect(Object.keys(routes)).toEqual([
    "POST /api/rooms",
    "POST /api/rooms/:id/turns",
    "GET /api/rooms/:id/stream"
  ]);
});
