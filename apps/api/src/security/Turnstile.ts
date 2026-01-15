import { Context, Effect } from "effect";
import * as Schema from "effect/Schema";

export class TurnstileError extends Schema.TaggedError<TurnstileError>()("TurnstileError", {
  reason: Schema.String
}) {}

export interface TurnstileService {
  verifyToken: (token: string) => Effect.Effect<boolean, TurnstileError, never>;
}

export class Turnstile extends Context.Tag("Turnstile")<Turnstile, TurnstileService>() {}

export const TurnstileLive = Turnstile.of({
  verifyToken: (token) => Effect.sync(() => token.trim().length > 0)
});
