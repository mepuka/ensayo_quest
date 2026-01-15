import { it, expect } from "bun:test";
import { Effect } from "effect";
import { TurnstileLive } from "../Turnstile";

it("rejects empty Turnstile token", async () => {
  const ok = await Effect.runPromise(TurnstileLive.verifyToken(""));
  expect(ok).toBe(false);
});
