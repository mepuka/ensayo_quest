import { it, expect } from "bun:test";
import { scoreFluency } from "../Fluency";

it("computes phonation ratio", () => {
  const score = scoreFluency(
    { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] },
    "hola mundo"
  );
  expect(score).toBeGreaterThan(0);
});
