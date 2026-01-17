import React from "react";
import { createRoot } from "react-dom/client";
import { useAtomSet, useAtomValue, Result } from "@effect-atom/atom-react";
import { Effect, Fiber } from "effect";
import type { RuntimeFiber } from "effect/Fiber";
import * as Option from "effect/Option";

import { ScorePanel } from "./components/ScorePanel";
import { roomIdAtom, roomStateAtom } from "./eventlog/RoomEventAtoms";
import { initialRoomState, deriveScorePanelState } from "./eventlog/RoomEventReducer";
import { encodeWav } from "./asr/wav";
import {
  asrStateAtom,
  asrResultAtom,
  attachRequestId,
  getAsrService,
  localAsrAtom,
  reduceAsrState
} from "./asr/AsrAtoms";
import {
  createRoomFn,
  submitTurnFn,
  uploadAudioFn,
  type CreateRoomInput,
  type SubmitTurnInput,
  type UploadAudioInput
} from "./http/HttpAtoms";

// =============================================================================
// Helper: Extract status from Result
// =============================================================================

type HttpStatus = "idle" | "pending" | "success" | "error";

const getHttpStatus = <A, E>(result: Result.Result<A, E>): HttpStatus => {
  // Waiting means in progress (either initial or refetching)
  if (Result.isWaiting(result)) return "pending";
  if (Result.isInitial(result)) return "idle";
  if (Result.isSuccess(result)) return "success";
  return "error";
};

const getHttpError = <A, E>(result: Result.Result<A, E>): E | null => {
  const errorOption = Result.error(result);
  return Option.getOrNull(errorOption);
};

// =============================================================================
// Frontend Component
// =============================================================================

export const Frontend = () => {
  // Event-sourced state (survives refresh)
  const roomId = useAtomValue(roomIdAtom);
  const roomStateResult = useAtomValue(roomStateAtom);
  const roomState = Result.getOrElse(roomStateResult, () => initialRoomState);
  const scorePanelState = deriveScorePanelState(roomState);

  // ASR state
  const asrServiceResult = useAtomValue(localAsrAtom);
  const asrState = useAtomValue(asrStateAtom);
  const setAsrState = useAtomSet(asrStateAtom);

  // HTTP atoms - Result tracks loading/error states
  const createRoomResult = useAtomValue(createRoomFn);
  const createRoom = useAtomSet(createRoomFn);
  const submitTurnResult = useAtomValue(submitTurnFn);
  const submitTurn = useAtomSet(submitTurnFn);
  const uploadAudioResult = useAtomValue(uploadAudioFn);
  const uploadAudio = useAtomSet(uploadAudioFn);

  // ASR result with attached requestId for idempotent submission
  const lastAsrResult = useAtomValue(asrResultAtom);
  const setAsrResult = useAtomSet(asrResultAtom);

  // Transient form state (doesn't survive refresh - that's OK)
  const [formTopic, setFormTopic] = React.useState("restaurant");
  const [formLevel, setFormLevel] = React.useState("A2");

  // Track running ASR fibers for cleanup on unmount
  const asrFiberRef = React.useRef<RuntimeFiber<unknown, unknown> | null>(null);
  const isMountedRef = React.useRef(true);

  // Cleanup Effect fibers on unmount
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Interrupt any running ASR fiber
      if (asrFiberRef.current) {
        Effect.runFork(Fiber.interrupt(asrFiberRef.current));
        asrFiberRef.current = null;
      }
    };
  }, []);

  // Derive values
  const activeRoomId = Option.isSome(roomId) ? roomId.value : "";

  // Use event-sourced values when available, form values otherwise
  const displayTopic = roomState.topic ?? formTopic;
  const displayLevel = roomState.level ?? formLevel;
  const displaySeedPrompt = roomState.seedPrompt;

  // HTTP status from atom Results
  const createRoomStatus = getHttpStatus(createRoomResult);
  const createRoomError = getHttpError(createRoomResult);
  const submitTurnStatus = getHttpStatus(submitTurnResult);
  const submitTurnError = getHttpError(submitTurnResult);
  const uploadAudioStatus = getHttpStatus(uploadAudioResult);
  const uploadAudioError = getHttpError(uploadAudioResult);

  // Track which turnId we've already started uploading for (avoid duplicates)
  const uploadedTurnIdRef = React.useRef<string | null>(null);

  // Chain audio upload after submitTurn success (Architecture Invariant #9)
  // Scoring is gated on AudioUploaded, so we must upload after turn is accepted
  React.useEffect(() => {
    if (
      Result.isSuccess(submitTurnResult) &&
      !Result.isWaiting(submitTurnResult) &&
      lastAsrResult &&
      lastAsrResult.audio.length > 0 &&
      lastAsrResult.sampleRate
    ) {
      const turnId = submitTurnResult.value.turnId;
      // Only upload once per turnId
      if (uploadedTurnIdRef.current !== turnId) {
        uploadedTurnIdRef.current = turnId;
        const wav = encodeWav(lastAsrResult.audio, lastAsrResult.sampleRate);
        uploadAudio({
          turnId,
          roomId: activeRoomId,
          requestId: lastAsrResult.requestId,
          audio: wav,
          contentType: "audio/wav"
        });
      }
    }
  }, [submitTurnResult, lastAsrResult, activeRoomId, uploadAudio]);

  // =============================================================================
  // Action Handlers
  // =============================================================================

  const runCreateRoom = () => {
    // Generate requestId when user clicks button (Architecture Invariant #2)
    const requestId = crypto.randomUUID();
    const input: CreateRoomInput = {
      requestId,
      topic: formTopic,
      level: formLevel,
      mode: "practice"
    };
    createRoom(input);
    // Note: URL update happens in createRoomFn via pushstate event
  };

  const runSubmitTurn = () => {
    const transcript = asrState.transcript.trim();
    if (!activeRoomId || !transcript || !lastAsrResult) {
      return;
    }

    // Use the requestId attached when ASR stopped (Architecture Invariant #2)
    // This ensures idempotency: same ASR result → same requestId → same turn
    const requestId = lastAsrResult.requestId;

    const durationMs = lastAsrResult.durationMs;
    const words = transcript.split(/\s+/).filter(Boolean).length;
    const durationMinutes = durationMs > 0 ? durationMs / 60000 : 0;
    const speakingRateWpm =
      durationMinutes > 0 ? Math.round(words / durationMinutes) : 0;

    const input: SubmitTurnInput = {
      roomId: activeRoomId,
      requestId,
      transcript,
      language: "es",
      clientTimestamp: Date.now(),
      audioFeatures: {
        durationMs,
        pauseCount: 0,
        speakingRateWpm
      },
      asrSource: "whisper-base"
    };

    submitTurn(input);
    // Audio upload is chained via useEffect observing submitTurnResult
  };

  const runAsrStart = () => {
    const asr = getAsrService(asrServiceResult);
    if (!asr) {
      setAsrState((current) =>
        reduceAsrState(current, { type: "error", message: "asr_not_ready" })
      );
      return;
    }
    setAsrState((current) => reduceAsrState(current, { type: "start" }));

    // Cancel any existing ASR operation before starting new one
    if (asrFiberRef.current) {
      Effect.runFork(Fiber.interrupt(asrFiberRef.current));
    }

    const program = Effect.scoped(asr.start()).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          if (isMountedRef.current) {
            setAsrState((current) =>
              reduceAsrState(current, { type: "error", message: String(error) })
            );
          }
        })
      )
    );
    asrFiberRef.current = Effect.runFork(program);
  };

  const runAsrStop = () => {
    const asr = getAsrService(asrServiceResult);
    if (!asr) {
      setAsrState((current) =>
        reduceAsrState(current, { type: "error", message: "asr_not_ready" })
      );
      return;
    }

    // Cancel any existing ASR operation before stopping
    if (asrFiberRef.current) {
      Effect.runFork(Fiber.interrupt(asrFiberRef.current));
    }

    const program = Effect.scoped(asr.stop()).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (isMountedRef.current) {
            // Attach requestId when ASR stops for idempotent turn submission
            // (Architecture Invariant #2: All commands are idempotent via requestId)
            const resultWithId = attachRequestId(result);
            setAsrResult(resultWithId);
            setAsrState((current) =>
              reduceAsrState(current, { type: "stop", transcript: result.transcript })
            );
          }
        })
      ),
      Effect.catchAll((error) =>
        Effect.sync(() => {
          if (isMountedRef.current) {
            setAsrState((current) =>
              reduceAsrState(current, { type: "error", message: String(error) })
            );
          }
        })
      )
    );
    asrFiberRef.current = Effect.runFork(program);
  };

  // =============================================================================
  // Render
  // =============================================================================

  return (
    <main>
      <h1>Ensayo Quest</h1>
      <section>
        <h2>Room Setup</h2>
        <label>
          Topic
          <input
            value={formTopic}
            onChange={(event) => setFormTopic(event.target.value)}
            placeholder="restaurant"
          />
        </label>
        <label>
          Level
          <input
            value={formLevel}
            onChange={(event) => setFormLevel(event.target.value)}
            placeholder="A2"
          />
        </label>
        <button type="button" onClick={runCreateRoom}>
          Create Room
        </button>
        {createRoomStatus === "pending" ? <p>Creating room...</p> : null}
        {createRoomStatus === "error" && createRoomError ? (
          <p data-status="error">{String(createRoomError)}</p>
        ) : null}
        {activeRoomId ? <p>Room: {activeRoomId}</p> : null}
        {displaySeedPrompt ? <p>Seed prompt: {displaySeedPrompt}</p> : null}
        {activeRoomId ? (
          <p>
            Topic: {displayTopic} | Level: {displayLevel}
          </p>
        ) : null}
      </section>
      <ScorePanel
        turnId={scorePanelState.turnId}
        status={scorePanelState.status}
        overall={scorePanelState.overall}
      />
      {scorePanelState.npcPrompt ? <p>NPC: {scorePanelState.npcPrompt}</p> : null}
      <section data-asr-status={asrState.status}>
        <h2>Transcription</h2>
        {asrState.error ? <p data-asr-error>{asrState.error}</p> : null}
        <p>{asrState.transcript || "No transcript yet."}</p>
      </section>
      <button type="button" onClick={runAsrStart}>
        Start ASR
      </button>
      <button type="button" onClick={runAsrStop}>
        Stop ASR
      </button>
      <button type="button" onClick={runSubmitTurn}>
        Submit Turn
      </button>
      {submitTurnStatus === "pending" ? <p>Submitting turn...</p> : null}
      {submitTurnStatus === "error" && submitTurnError ? (
        <p data-status="error">{String(submitTurnError)}</p>
      ) : null}
      {uploadAudioStatus === "pending" ? <p>Uploading audio...</p> : null}
      {uploadAudioStatus === "error" && uploadAudioError ? (
        <p data-status="error">{String(uploadAudioError)}</p>
      ) : null}
    </main>
  );
};

// Only render in browser environment (not during test imports)
if (typeof document !== "undefined") {
  const rootElement = document.getElementById("root");
  if (rootElement) {
    createRoot(rootElement).render(<Frontend />);
  }
}
