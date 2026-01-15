import { Context, Effect } from "effect";

export interface AiService {
  runJson: (input: unknown) => Effect.Effect<unknown, unknown, never>;
}

export class Ai extends Context.Tag("Ai")<Ai, AiService>() {}
