import { Effect, Stream } from "effect";
import type { ASRConfig, ASRResult } from "./types";

export type ASREngine = {
  start: (config?: Partial<ASRConfig>) => Effect.Effect<void, never, never>;
  stop: () => Effect.Effect<ASRResult, never, never>;
  stream: Stream.Stream<ASRResult, never, never>;
};
