import { Atom, Result } from "@effect-atom/atom-react";
import { Effect, Layer } from "effect";
import { makeLocalAsr, browserWorkerLayer, type LocalAsrService } from "./LocalAsr";
import { WorkletCaptureLive } from "./worklet/WorkletCapture";

export type AsrState = {
  status: "idle" | "recording" | "stopped" | "error";
  transcript: string;
  error: string | null;
};

export type AsrEvent =
  | { type: "start" }
  | { type: "stop"; transcript: string }
  | { type: "error"; message: string };

export const initialAsrState: AsrState = {
  status: "idle",
  transcript: "",
  error: null
};

export const reduceAsrState = (state: AsrState, event: AsrEvent): AsrState => {
  switch (event.type) {
    case "start":
      return { status: "recording", transcript: "", error: null };
    case "stop":
      return { status: "stopped", transcript: event.transcript, error: null };
    case "error":
      return { status: "error", transcript: state.transcript, error: event.message };
  }
};

const asrLayer = Layer.mergeAll(browserWorkerLayer, WorkletCaptureLive);

export const localAsrAtom = Atom.make(
  makeLocalAsr.pipe(Effect.provide(asrLayer))
);

export const asrStateAtom = Atom.make(initialAsrState);

export const getAsrService = (result: Result.Result<LocalAsrService, Error>) =>
  Result.isSuccess(result) ? result.value : null;
