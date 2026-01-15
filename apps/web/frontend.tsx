import React from "react";
import { Effect, Layer } from "effect";
import { ScorePanel } from "./components/ScorePanel";
import { browserWorkerLayer, makeLocalAsr } from "./asr/LocalAsr";
import { WorkletCaptureLive } from "./asr/worklet/WorkletCapture";

export const Frontend = () => {
  const runAsrStart = () =>
    Effect.runPromise(
      Effect.scoped(
        makeLocalAsr.pipe(
          Effect.provide(Layer.mergeAll(browserWorkerLayer, WorkletCaptureLive)),
          Effect.flatMap((asr) => asr.start())
        )
      )
    );
  return (
    <main>
      <h1>Ensayo Quest</h1>
      <ScorePanel turnId="t1" status="pending" overall={null} />
      <button type="button" onClick={() => void runAsrStart()}>
        Start ASR
      </button>
    </main>
  );
};
