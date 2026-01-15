import { Context, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { ScenarioTemplate } from "../domain/ScenarioTemplate";
import { Ai } from "./Ai";
import { VectorStore } from "./VectorStore";

export interface ScenarioBuilderService {
  buildTemplate: (
    input: { topic: string; level: string }
  ) => Effect.Effect<ScenarioTemplate, unknown, never>;
}

export class ScenarioBuilder extends Context.Tag("ScenarioBuilder")<
  ScenarioBuilder,
  ScenarioBuilderService
>() {}

export const ScenarioBuilderLive = Layer.effect(
  ScenarioBuilder,
  Effect.gen(function* () {
    const ai = yield* Ai;
    const vectorStore = yield* VectorStore;
    const buildTemplate = Effect.fn(function* (input: { topic: string; level: string }) {
      const chunks = yield* vectorStore.query(input);
      const raw = yield* ai.runJson({ input, chunks });
      return yield* Schema.decodeUnknown(ScenarioTemplate)(raw);
    });
    return { buildTemplate };
  })
);
