import { it, expect } from "bun:test";
import { Effect } from "effect";
import { Turnstile, TurnstileLive } from "../Turnstile";

it("rejects empty Turnstile token", async () => {
  const program = Effect.gen(function* () {
    const turnstile = yield* Turnstile;
    return yield* turnstile.verifyToken("");
  }).pipe(Effect.provide(TurnstileLive));
  const ok = await Effect.runPromise(program);
  expect(ok).toBe(false);
});
