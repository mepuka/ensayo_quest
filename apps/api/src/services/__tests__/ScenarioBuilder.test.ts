import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ScenarioTemplate } from "../../domain/ScenarioTemplate";
import { Ai } from "../Ai";
import { ScenarioBuilder, ScenarioBuilderLive } from "../ScenarioBuilder";
import { VectorStore } from "../VectorStore";

it("builds a turn-scripted ScenarioTemplate", async () => {
  const aiLayer = Layer.succeed(Ai, {
    runJson: () =>
      Effect.succeed({
        templateId: "tpl-1",
        topic: "restaurant",
        level: "A2",
        seedPrompt: "Bienvenido",
        turnPlan: [
          { turnIndex: 0, speakerRole: "A", promptType: "user", objectiveIds: ["o1"] }
        ],
        roleRubrics: [
          { roleId: "A", targetVocab: ["pedir"], targetGrammar: ["polite_request"] }
        ]
      })
  });
  const vectorLayer = Layer.succeed(VectorStore, {
    query: () => Effect.succeed([])
  });
  const program = Effect.gen(function* () {
    const builder = yield* ScenarioBuilder;
    return yield* builder.buildTemplate({ topic: "restaurant", level: "A2" });
  });
  const layer = Layer.provideMerge(aiLayer)(ScenarioBuilderLive);
  const fullLayer = Layer.provideMerge(vectorLayer)(layer);
  const result = await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));
  expect(result).toBeInstanceOf(ScenarioTemplate);
});
