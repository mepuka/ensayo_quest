import React from "react";
import { Result, useAtomValue } from "@effect-atom/atom-react";
import { Effect, Layer } from "effect";
import * as Option from "effect/Option";
import { ScorePanel } from "./components/ScorePanel";
import { browserWorkerLayer, makeLocalAsr } from "./asr/LocalAsr";
import { WorkletCaptureLive } from "./asr/worklet/WorkletCapture";
import { roomIdAtom, scorePanelAtom } from "./eventlog/RoomEventAtoms";
import { initialScorePanelState } from "./eventlog/RoomEventReducer";

export const Frontend = () => {
  const roomId = useAtomValue(roomIdAtom);
  const scorePanelResult = useAtomValue(scorePanelAtom);
  const scorePanelState = Result.getOrElse(scorePanelResult, () =>
    initialScorePanelState("unknown")
  );
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
      {Option.isNone(roomId) || roomId.value.trim() === "" ? (
        <p data-status="warning">Missing roomId. Add ?roomId=... to the URL.</p>
      ) : null}
      <ScorePanel
        turnId={scorePanelState.turnId}
        status={scorePanelState.status}
        overall={scorePanelState.overall}
      />
      {scorePanelState.npcPrompt ? <p>NPC: {scorePanelState.npcPrompt}</p> : null}
      <button type="button" onClick={() => void runAsrStart()}>
        Start ASR
      </button>
    </main>
  );
};
