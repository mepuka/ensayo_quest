import React from "react";
import { createRoot } from "react-dom/client";
import { useAtomSet, useAtomValue, Result } from "@effect-atom/atom-react";
import { Effect, Fiber } from "effect";
import type { RuntimeFiber } from "effect/Fiber";
import * as Option from "effect/Option";
import { ScorePanel } from "./components/ScorePanel";
import { roomIdAtom, scorePanelAtom } from "./eventlog/RoomEventAtoms";
import { initialScorePanelState } from "./eventlog/RoomEventReducer";
import type { ASRResult } from "./asr/types";
import { encodeWav } from "./asr/wav";
import {
  asrStateAtom,
  getAsrService,
  localAsrAtom,
  reduceAsrState
} from "./asr/AsrAtoms";

export const Frontend = () => {
  const roomId = useAtomValue(roomIdAtom);
  const scorePanelResult = useAtomValue(scorePanelAtom);
  const scorePanelState = Result.getOrElse(scorePanelResult, () =>
    initialScorePanelState("unknown")
  );
  const asrServiceResult = useAtomValue(localAsrAtom);
  const asrState = useAtomValue(asrStateAtom);
  const setAsrState = useAtomSet(asrStateAtom);
  const [topic, setTopic] = React.useState("restaurant");
  const [level, setLevel] = React.useState("A2");
  const [seedPrompt, setSeedPrompt] = React.useState<string | null>(null);
  const [roomStatus, setRoomStatus] = React.useState<
    "idle" | "creating" | "ready" | "error"
  >("idle");
  const [roomError, setRoomError] = React.useState<string | null>(null);
  const [submitStatus, setSubmitStatus] = React.useState<
    "idle" | "submitting" | "submitted" | "error"
  >("idle");
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = React.useState<
    "idle" | "uploading" | "uploaded" | "error"
  >("idle");
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [lastAsrResult, setLastAsrResult] = React.useState<ASRResult | null>(
    null
  );
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

  const activeRoomId = Option.isSome(roomId) ? roomId.value : "";
  const updateRoomIdParam = (nextRoomId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("roomId", nextRoomId);
    window.history.replaceState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const runCreateRoom = async () => {
    setRoomStatus("creating");
    setRoomError(null);
    setSeedPrompt(null);
    setUploadStatus("idle");
    setUploadError(null);
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, level, mode: "practice" })
      });
      if (!response.ok) {
        const errorText = await response.text();
        setRoomStatus("error");
        setRoomError(errorText || "create_room_failed");
        return;
      }
      const data = (await response.json()) as {
        roomId: string;
        seedPrompt: string;
      };
      updateRoomIdParam(data.roomId);
      setSeedPrompt(data.seedPrompt);
      setRoomStatus("ready");
    } catch (error) {
      setRoomStatus("error");
      setRoomError(String(error));
    }
  };
  const runUploadAudio = async (turnId: string) => {
    if (!lastAsrResult || lastAsrResult.audio.length === 0) {
      return;
    }
    if (!lastAsrResult.sampleRate) {
      setUploadStatus("error");
      setUploadError("missing_sample_rate");
      return;
    }
    setUploadStatus("uploading");
    setUploadError(null);
    try {
      const wav = encodeWav(lastAsrResult.audio, lastAsrResult.sampleRate);
      const response = await fetch(`/api/turns/${turnId}/audio`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav
      });
      if (!response.ok) {
        const errorText = await response.text();
        setUploadStatus("error");
        setUploadError(errorText || "upload_failed");
        return;
      }
      setUploadStatus("uploaded");
    } catch (error) {
      setUploadStatus("error");
      setUploadError(String(error));
    }
  };
  const runSubmitTurn = async () => {
    const transcript = asrState.transcript.trim();
    if (!activeRoomId) {
      setSubmitStatus("error");
      setSubmitError("missing_room_id");
      return;
    }
    if (!transcript) {
      setSubmitStatus("error");
      setSubmitError("empty_transcript");
      return;
    }
    setSubmitStatus("submitting");
    setSubmitError(null);
    const durationMs = lastAsrResult?.durationMs ?? 0;
    const words = transcript.split(/\s+/).filter(Boolean).length;
    const durationMinutes = durationMs > 0 ? durationMs / 60000 : 0;
    const speakingRateWpm =
      durationMinutes > 0 ? Math.round(words / durationMinutes) : 0;
    const payload = {
      roomId: activeRoomId,
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
    try {
      const response = await fetch(`/api/rooms/${activeRoomId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorText = await response.text();
        setSubmitStatus("error");
        setSubmitError(errorText || "submit_turn_failed");
        return;
      }
      const data = (await response.json()) as { turnId: string };
      setSubmitStatus("submitted");
      void runUploadAudio(data.turnId);
    } catch (error) {
      setSubmitStatus("error");
      setSubmitError(String(error));
    }
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
            setLastAsrResult(result);
            setSubmitStatus("idle");
            setSubmitError(null);
            setUploadStatus("idle");
            setUploadError(null);
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
  return (
    <main>
      <h1>Ensayo Quest</h1>
      <section>
        <h2>Room Setup</h2>
        <label>
          Topic
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="restaurant"
          />
        </label>
        <label>
          Level
          <input
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            placeholder="A2"
          />
        </label>
        <button type="button" onClick={() => void runCreateRoom()}>
          Create Room
        </button>
        {roomStatus === "creating" ? <p>Creating room...</p> : null}
        {roomStatus === "error" && roomError ? <p data-status="error">{roomError}</p> : null}
        {activeRoomId ? <p>Room: {activeRoomId}</p> : null}
        {seedPrompt ? <p>Seed prompt: {seedPrompt}</p> : null}
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
      <button type="button" onClick={() => void runAsrStart()}>
        Start ASR
      </button>
      <button type="button" onClick={() => void runAsrStop()}>
        Stop ASR
      </button>
      <button type="button" onClick={() => void runSubmitTurn()}>
        Submit Turn
      </button>
      {submitStatus === "submitting" ? <p>Submitting turn...</p> : null}
      {submitStatus === "error" && submitError ? (
        <p data-status="error">{submitError}</p>
      ) : null}
      {uploadStatus === "uploading" ? <p>Uploading audio...</p> : null}
      {uploadStatus === "error" && uploadError ? (
        <p data-status="error">{uploadError}</p>
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
