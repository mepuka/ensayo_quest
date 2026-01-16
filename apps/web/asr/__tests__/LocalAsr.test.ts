import { it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { Worker } from "@effect/platform";
import { makeLocalAsr } from "../LocalAsr";
import { WorkletCapture } from "../worklet/WorkletCapture";
import type { TranscribeResponse } from "../worker/WorkerClient";

it("returns a LocalASR instance", () => {
  const workerLayer = Layer.succeed(Worker.WorkerManager, {
    [Worker.WorkerManagerTypeId]: Worker.WorkerManagerTypeId,
    spawn: <I, O, E>() =>
      Effect.succeed({
        id: 0,
        execute: () => Stream.empty,
        executeEffect: () =>
          Effect.succeed({ type: "result", transcript: "" } as unknown as O)
      } as Worker.Worker<I, O, E>)
  });
  const spawnerLayer = Layer.succeed(Worker.Spawner, () => ({}));
  const captureLayer = Layer.succeed(WorkletCapture, {
    start: () => Effect.void,
    stop: () => Effect.void,
    stream: Stream.empty
  });
  const layer = Layer.mergeAll(workerLayer, spawnerLayer, captureLayer);
  const program = makeLocalAsr.pipe(
    Effect.provide(layer),
    Effect.scoped // Required because makeLocalAsr uses scoped worker resources
  );
  return Effect.runPromise(
    Effect.map(program, (localAsr) => {
      expect(localAsr.start).toBeDefined();
      expect(localAsr.stop).toBeDefined();
    })
  );
});
