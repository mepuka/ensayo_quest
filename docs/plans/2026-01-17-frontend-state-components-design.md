# Frontend State & Components Design

## Overview

Refactor the monolithic `frontend.tsx` into a declarative, mode-based component architecture using:
- **@effect-atom/atom-react** for reactive state management
- **shadcn/ui + Tailwind** for accessible UI components
- **Composite hooks** as the "fool proof" API layer
- **Derived atoms** via `Atom.readable()` for composed state (Effect-native patterns)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI Library | shadcn/ui + Tailwind | Accessible primitives, components in codebase, full control |
| Atom Organization | Flat with naming conventions | Simple navigation, conventions enforce separation |
| Component Structure | Mode-based (horizontal slices) | Clear sequential flow: Setup → Playing → Complete |
| Hook Pattern | Composite hooks per feature | Clean API, hides atom coordination, handles cleanup |
| Loading/Error | Declarative wrapper components | Consistent UX, components focus on happy path |
| Recording State | Derived atoms with `Atom.readable()` | Effect-native, granular testing, automatic reactivity |

## Atom Structure

```
apps/web/atoms/
├── room.ts              # Event-sourced room state
├── room.ops.ts          # Room operations (create, submit, upload)
├── turn.ts              # Pending turn + audio upload state (ephemeral)
├── app.ts               # App readiness coordination
├── recording.ts         # Model, VAD, ASR base atoms
├── recording.ops.ts     # Recording operations (preload, start, stop)
├── recording.derived.ts # Composed recording state via Atom.readable()
├── recording.vad.ts     # VAD event stream integration
├── connection.ts        # WebSocket status, reconnection, sync state
├── conversation.ts      # Derived atoms for turn history
└── score.ts             # Derived atoms for score tracking
```

### Naming Conventions

- `*Atom` suffix for reactive state: `roomStateAtom`, `modelStatusAtom`
- `*Fn` suffix for operations: `createRoomFn`, `preloadModelFn`
- `.derived.ts` files for composed atoms using `Atom.readable()`

### Event-Sourced Atoms (survive refresh)

```typescript
// atoms/room.ts
import { Atom } from "@effect-atom/atom-react";
import { Stream } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// URL param binding - returns Option when schema provided
export const roomIdAtom = Atom.searchParam("roomId", { schema: Schema.String });

// Event stream from WebSocket
export const roomEventsAtom = Atom.make((get) => {
  const roomId = get(roomIdAtom);
  if (Option.isNone(roomId) || roomId.value.trim() === "") return Stream.empty;
  return getRoomEventStream(roomId.value);
});

// Event-sourced projection via Stream.scan
export const roomStateAtom = Atom.make((get) => {
  const events = get.streamResult(roomEventsAtom);
  return Stream.scan(events, initialRoomState, reduceRoomEvent);
});
```

### Transient Atoms (ephemeral UI state)

```typescript
// atoms/recording.ts
import { Atom } from "@effect-atom/atom-react";
import { Data, Match } from "effect";

// Model loading with granular states
export type ModelLoadingState = {
  status: "idle" | "checking_cache" | "downloading" | "initializing" | "ready" | "error";
  downloadProgress?: number;  // 0-100
  error?: string;
};

export const modelLoadingAtom = Atom.make<ModelLoadingState>({ status: "idle" });

// Simplified status for components
export const modelStatusAtom = modelLoadingAtom.pipe(
  Atom.map((s) => s.status === "ready" ? "ready" : s.status === "error" ? "error" : "loading")
);

// VAD events using Data.TaggedEnum
export const VadEvent = Data.taggedEnum<{
  SpeechStart: {};
  SpeechEnd: { audio: Float32Array };
  FrameProcessed: { probability: number };
}>();
export type VadEvent = Data.TaggedEnum.Value<typeof VadEvent>;

export const vadEventAtom = Atom.make<VadEvent | null>(null);

// Speech probability for UI feedback (waveform, indicator)
export const speechProbabilityAtom = Atom.make<number>(0);

// ASR result with requestId for idempotent submission
export type AsrResult = {
  transcript: string;
  requestId: string;
  durationMs: number;
  sampleRate: number;
  audio: Float32Array;
};

export const asrResultAtom = Atom.make<AsrResult | null>(null);

// Recording metrics for duration tracking
export type RecordingMetrics = {
  startedAt: number | null;
  durationMs: number;
};

export const recordingMetricsAtom = Atom.make<RecordingMetrics>({
  startedAt: null,
  durationMs: 0
});

// Microphone permission tracking
export type MicPermission = "unknown" | "pending" | "granted" | "denied";
export const micPermissionAtom = Atom.make<MicPermission>("unknown");

// Pending turn for optimistic UI + audio upload
export type PendingTurn = {
  requestId: string;
  transcript: string;
  createdAt: number;
};

export const pendingTurnsAtom = Atom.make<ReadonlyArray<PendingTurn>>([]);
```

### Derived Atoms (composed state via Atom.readable)

```typescript
// atoms/recording.derived.ts
import { Atom } from "@effect-atom/atom-react";
import { Match } from "effect";

export type RecordingPhase =
  | "no_permission"  // mic permission denied
  | "not_ready"      // model not loaded
  | "ready"          // model loaded, waiting for speech
  | "listening"      // VAD detected speech start
  | "processing"     // speech ended, ASR running
  | "result"         // transcript available
  | "error";         // error occurred

export const recordingPhaseAtom = Atom.readable((get) => {
  const permission = get(micPermissionAtom);
  const model = get(modelStatusAtom);
  const vad = get(vadEventAtom);
  const asr = get(asrResultAtom);

  // Permission check first
  if (permission === "denied") return "no_permission" as const;

  // Model status
  if (model === "error") return "error" as const;
  if (model !== "ready") return "not_ready" as const;

  // ASR result available
  if (asr) return "result" as const;

  // No VAD event yet
  if (!vad) return "ready" as const;

  // Match VAD events using Effect pattern matching
  return Match.value(vad).pipe(
    Match.tag("SpeechEnd", () => "processing" as const),
    Match.tag("SpeechStart", () => "listening" as const),
    Match.tag("FrameProcessed", () => "listening" as const),
    Match.exhaustive
  );
});

// Auto-stop recording after max duration (2 minutes)
const MAX_RECORDING_DURATION_MS = 120_000;

export const shouldAutoStopAtom = Atom.readable((get) => {
  const metrics = get(recordingMetricsAtom);
  return metrics.durationMs >= MAX_RECORDING_DURATION_MS;
});
```

### VAD Tuning (Language Learners)

```typescript
// atoms/recording.vad.ts
export const vadConfig = {
  positiveSpeechThreshold: 0.4,
  redemptionMs: 1000,
  minSpeechMs: 500
} as const;
```

Tune with real user data; defaults are intentionally lenient for hesitant speakers.

### Connection & Sync State

```typescript
// atoms/connection.ts
import { Atom, Result } from "@effect-atom/atom-react";
import * as Option from "effect/Option";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export const connectionStatusAtom = Atom.make<ConnectionStatus>("disconnected");

// Sync state for UI (show "syncing" indicator after reconnect)
export type SyncState = "synced" | "syncing" | "disconnected" | "stale";

export const syncStateAtom = Atom.readable((get) => {
  const roomId = get(roomIdAtom);
  const conn = get(connectionStatusAtom);
  const roomStateResult = get(roomStateAtom);

  if (Option.isNone(roomId)) return "disconnected" as const;
  if (conn === "disconnected") return "disconnected" as const;
  if (conn === "connecting" || conn === "reconnecting") return "syncing" as const;
  if (conn === "connected" && Result.isSuccess(roomStateResult)) return "synced" as const;
  return "syncing" as const;
});

// Reconnection operation
export const reconnectFn = Atom.runtime.fn<{ roomId: string }>(
  Effect.fnUntraced(function* ({ roomId }) {
    clearRoomConnection(roomId);
    // Next atom read will trigger new connection
  })
);
```

### App Readiness Coordination

```typescript
// atoms/app.ts
import { Atom, Result } from "@effect-atom/atom-react";
import * as Option from "effect/Option";

export type AppReadyState =
  | "idle"
  | "loading_model"
  | "connecting"
  | "syncing"
  | "ready"
  | "error";

export const appReadyAtom = Atom.readable((get) => {
  const roomId = get(roomIdAtom);
  const model = get(modelStatusAtom);
  const conn = get(connectionStatusAtom);
  const roomStateResult = get(roomStateAtom);

  if (Option.isNone(roomId)) return "idle" as const;
  if (model === "error") return "error" as const;
  if (model !== "ready") return "loading_model" as const;
  if (conn !== "connected") return "connecting" as const;
  if (!Result.isSuccess(roomStateResult)) return "syncing" as const;
  return "ready" as const;
});
```

Use `appReadyAtom` to gate recording/submit actions and to show a single, user-friendly readiness status.

Coordination map:
- `appReadyAtom` from `roomIdAtom` + `modelStatusAtom` + `connectionStatusAtom` + `roomStateAtom` result
- `useRecording.canRecord` from `appReadyAtom` + `recordingPhaseAtom`
- `useTurn.canSubmit` from `appReadyAtom` + `asrResultAtom` + submit/upload status + room state
- `uploadAudioFn` from submit success + `asrResultAtom` (same requestId), then clears ASR after upload

### Conversation & Score Derived Atoms

```typescript
// atoms/conversation.ts
import { Atom, Result } from "@effect-atom/atom-react";
import * as Option from "effect/Option";

export const conversationHistoryAtom = Atom.readable((get) => {
  const stateResult = get(roomStateAtom);
  const state = Option.getOrUndefined(Result.value(stateResult));
  return state?.history ?? [];
});

export const playerTurnsAtom = conversationHistoryAtom.pipe(
  Atom.map((history) => history.filter(h => h.role === "player"))
);

export const npcTurnsAtom = conversationHistoryAtom.pipe(
  Atom.map((history) => history.filter(h => h.role === "npc"))
);

export const currentPromptAtom = Atom.readable((get) => {
  const stateResult = get(roomStateAtom);
  const state = Option.getOrUndefined(Result.value(stateResult));
  // Current step's prompt or latest NPC response
  return state?.currentPrompt ?? state?.seedPrompt ?? null;
});
```

```typescript
// atoms/score.ts
import { Atom } from "@effect-atom/atom-react";

export type ScoreEntry = {
  turnId: string;
  score: number;
  feedback: string;
  timestamp: number;
};

export const scoreHistoryAtom = Atom.readable((get) => {
  const history = get(conversationHistoryAtom);
  return history
    .filter(h => h.role === "npc" && h.evaluation)
    .map(h => ({
      turnId: h.turnId ?? "",
      score: h.evaluation?.overallScore ?? 0,
      feedback: h.evaluation?.feedback ?? "",
      timestamp: h.timestamp ?? 0
    }));
});

export const cumulativeScoreAtom = scoreHistoryAtom.pipe(
  Atom.map((history) => history.reduce((sum, s) => sum + s.score, 0))
);

export const latestScoreAtom = scoreHistoryAtom.pipe(
  Atom.map((history) => history[history.length - 1] ?? null)
);
```

### Optimistic UI Overlay (Pending Turns)

```typescript
// atoms/turn.ts
import { Atom } from "@effect-atom/atom-react";

export const pendingTurnsOptimisticAtom = pendingTurnsAtom.pipe(Atom.optimistic);

export const submitTurnOptimistic = pendingTurnsOptimisticAtom.pipe(
  Atom.optimisticFn({
    reducer: (current, input: SubmitTurnInput) => ([
      ...current,
      {
        requestId: input.requestId,
        transcript: input.transcript,
        createdAt: Date.now()
      }
    ]),
    fn: submitTurnFn
  })
);

export const conversationWithPendingAtom = Atom.readable((get) => {
  const history = get(conversationHistoryAtom);
  const pending = get(pendingTurnsOptimisticAtom);
  if (pending.length === 0) return history;
  return history.concat(
    pending.map((turn) => ({
      role: "player",
      text: turn.transcript,
      timestamp: turn.createdAt,
      requestId: turn.requestId,
      pending: true
    }))
  );
});
```

Pending items are UI-only; clear by matching requestId once `TurnAccepted` arrives from the EventLog.

### Operation Atoms (Atom.runtime.fn)

```typescript
// atoms/room.ops.ts
import { Atom } from "@effect-atom/atom-react";
import { Effect } from "effect";
import * as FetchHttpClient from "@effect/platform/FetchHttpClient";

// Provide HttpClient via a runtime layer.
const httpRuntime = Atom.runtime(FetchHttpClient.layer);

export const createRoomFn = httpRuntime.fn<CreateRoomInput>()(
  Effect.fnUntraced(function* (input) {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

    const request = HttpClientRequest.post("/api/rooms").pipe(
      HttpClientRequest.setHeader("Content-Type", "application/json"),
      HttpClientRequest.bodyText(JSON.stringify(input))
    );

    const response = yield* client.execute(request);
    const data = yield* HttpClientResponse.schemaBodyJson(CreateRoomResponse)(response);

    // Update URL param
    const url = new URL(window.location.href);
    url.searchParams.set("roomId", data.roomId);
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new Event("pushstate"));

    return data;
  })
);

export const submitTurnFn = httpRuntime.fn<SubmitTurnInput>()(
  Effect.fnUntraced(function* (input) {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

    const request = HttpClientRequest.post(`/api/rooms/${input.roomId}/turns`).pipe(
      HttpClientRequest.setHeader("Content-Type", "application/json"),
      HttpClientRequest.bodyText(JSON.stringify(input))
    );

    const response = yield* client.execute(request);
    return yield* HttpClientResponse.schemaBodyJson(SubmitTurnResponse)(response);
  })
);

export const uploadAudioFn = httpRuntime.fn<UploadAudioInput>()(
  Effect.fnUntraced(function* (input) {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

    const request = HttpClientRequest.post(`/api/turns/${input.turnId}/audio`).pipe(
      HttpClientRequest.setHeader("Content-Type", input.contentType ?? "audio/wav"),
      HttpClientRequest.setHeader("X-Room-Id", input.roomId),
      HttpClientRequest.setHeader("X-Request-Id", input.requestId),
      HttpClientRequest.bodyUint8Array(new Uint8Array(input.audio))
    );

    const response = yield* client.execute(request);
    return yield* HttpClientResponse.schemaBodyJson(TurnAudioResponse)(response);
  })
);
```

## Composite Hooks

Hooks wrap atoms into clean component APIs with automatic cleanup.

### useRoom

```typescript
// hooks/useRoom.ts
import { useAtomValue, useAtomSet } from "@effect-atom/atom-react";
import { Result } from "@effect-atom/atom-react";
import * as Option from "effect/Option";

export function useRoom() {
  const roomIdOption = useAtomValue(roomIdAtom);
  const roomId = Option.getOrNull(roomIdOption);
  const roomStateResult = useAtomValue(roomStateAtom);
  const state = Option.getOrNull(Result.value(roomStateResult));
  const conversation = useAtomValue(conversationWithPendingAtom);
  const connection = useAtomValue(connectionStatusAtom);
  const syncState = useAtomValue(syncStateAtom);

  const create = useAtomSet(createRoomFn);
  const createResult = useAtomValue(createRoomFn);
  const reconnect = useAtomSet(reconnectFn);

  // Derive status from Result (use isWaiting, not isLoading)
  const createStatus = Result.isWaiting(createResult) ? "pending"
                     : Result.isSuccess(createResult) ? "success"
                     : Result.isFailure(createResult) ? "error"
                     : "idle";

  return {
    roomId,
    state,
    conversation,
    connection,
    syncState,
    create,
    createStatus,
    createError: Result.isFailure(createResult) ? Result.error(createResult) : null,
    reconnect
  };
}
```

### useRecording

```typescript
// hooks/useRecording.ts
import { useAtomValue, useAtomSet } from "@effect-atom/atom-react";
import { useEffect, useRef } from "react";

export function useRecording() {
  const appReady = useAtomValue(appReadyAtom);
  const phase = useAtomValue(recordingPhaseAtom);
  const result = useAtomValue(asrResultAtom);
  const metrics = useAtomValue(recordingMetricsAtom);
  const speechProbability = useAtomValue(speechProbabilityAtom);
  const micPermission = useAtomValue(micPermissionAtom);
  const shouldAutoStop = useAtomValue(shouldAutoStopAtom);

  const preload = useAtomSet(preloadModelFn);
  const start = useAtomSet(startRecordingFn);
  const stop = useAtomSet(stopRecordingFn);
  const clearResult = useAtomSet(asrResultAtom);

  // Track active recording for cleanup
  const isRecordingRef = useRef(false);

  // Cleanup on unmount - stop any active recording
  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        stop();
      }
    };
  }, [stop]);

  // Auto-stop when duration limit reached
  useEffect(() => {
    if (shouldAutoStop && isRecordingRef.current) {
      stop();
    }
  }, [shouldAutoStop, stop]);

  // Wrap start/stop to track recording state
  const startRecording = () => {
    isRecordingRef.current = true;
    start();
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    stop();
  };

  return {
    appReady,
    canRecord: appReady === "ready",
    phase,
    result,
    metrics,
    speechProbability,
    micPermission,
    preload,
    start: startRecording,
    stop: stopRecording,
    clearResult: () => clearResult(null)
  };
}
```

### useTurn

```typescript
// hooks/useTurn.ts
import { useAtomValue, useAtomSet } from "@effect-atom/atom-react";
import { Result } from "@effect-atom/atom-react";
import { useCallback, useEffect, useRef } from "react";

export function useTurn() {
  const { state, roomId } = useRoom();
  const { result: asrResult, clearResult, appReady } = useRecording();

  const submit = useAtomSet(submitTurnOptimistic);
  const submitResult = useAtomValue(submitTurnFn);
  const uploadAudio = useAtomSet(uploadAudioFn);
  const uploadAudioResult = useAtomValue(uploadAudioFn);

  const submitStatus = Result.isWaiting(submitResult) ? "pending"
                     : Result.isSuccess(submitResult) ? "success"
                     : Result.isFailure(submitResult) ? "error"
                     : "idle";

  const uploadStatus = Result.isWaiting(uploadAudioResult) ? "pending"
                     : Result.isSuccess(uploadAudioResult) ? "success"
                     : Result.isFailure(uploadAudioResult) ? "error"
                     : "idle";

  // Prevent double-submit: disabled when pending or no ASR result
  const canSubmit = submitStatus !== "pending"
                 && uploadStatus !== "pending"
                 && asrResult !== null
                 && appReady === "ready"
                 && state?.status === "playing";

  // Track which turnId we've already uploaded (avoid duplicates)
  const uploadedTurnIdRef = useRef<string | null>(null);

  // Chain audio upload after submitTurn success (Invariant #9)
  useEffect(() => {
    if (
      Result.isSuccess(submitResult) &&
      !Result.isWaiting(submitResult) &&
      asrResult &&
      roomId
    ) {
      const turnId = submitResult.value.turnId;
      if (uploadedTurnIdRef.current !== turnId) {
        uploadedTurnIdRef.current = turnId;
        const wav = encodeWav(asrResult.audio, asrResult.sampleRate);
        uploadAudio({
          turnId,
          roomId,
          requestId: asrResult.requestId,
          audio: wav,
          contentType: "audio/wav"
        });
      }
    }
  }, [submitResult, asrResult, roomId, uploadAudio]);

  // Clear ASR result only after audio upload succeeds
  useEffect(() => {
    if (Result.isSuccess(uploadAudioResult) && !Result.isWaiting(uploadAudioResult)) {
      clearResult();
    }
  }, [uploadAudioResult, clearResult]);

  // Submit with debounce protection
  const submitTurn = useCallback(() => {
    if (!canSubmit || !asrResult || !roomId) return;

    submit({
      roomId,
      requestId: asrResult.requestId,
      transcript: asrResult.transcript,
      language: "es",
      clientTimestamp: Date.now(),
      audioFeatures: {
        durationMs: asrResult.durationMs,
        pauseCount: 0,
        speakingRateWpm: 0
      }
    });
  }, [canSubmit, asrResult, roomId, submit]);

  return {
    currentPrompt: state?.currentPrompt,
    submitTurn,
    submitStatus,
    uploadStatus,
    canSubmit,
    submitError: Result.isFailure(submitResult) ? Result.error(submitResult) : null
  };
}
```

### useConnection

```typescript
// hooks/useConnection.ts
import { useAtomValue, useAtomSet } from "@effect-atom/atom-react";
import { useEffect } from "react";
import * as Option from "effect/Option";

export function useConnection() {
  const status = useAtomValue(connectionStatusAtom);
  const syncState = useAtomValue(syncStateAtom);
  const roomIdOption = useAtomValue(roomIdAtom);
  const roomId = Option.getOrNull(roomIdOption);
  const reconnect = useAtomSet(reconnectFn);

  // Cleanup connection on unmount or roomId change
  useEffect(() => {
    return () => {
      if (roomId) {
        clearRoomConnection(roomId);
      }
    };
  }, [roomId]);

  return {
    status,
    syncState,
    reconnect: () => roomId && reconnect({ roomId }),
    isConnected: status === "connected",
    isReconnecting: status === "reconnecting"
  };
}
```

## Component Structure

### Mode-Based Routing

```typescript
// components/App.tsx
import { Match } from "effect";

export function App() {
  const { roomId, state } = useRoom();

  // Mode routing using Effect Match
  const hasRoomId = !!roomId;
  const status = state?.status;

  return Match.value({ hasRoomId, status }).pipe(
    Match.when({ hasRoomId: false }, () => <RoomSetup />),
    Match.when({ status: "completed" }, () => <GameComplete />),
    Match.orElse(() => <GameSession />)
  );
}
```

### Component Hierarchy

```
components/
├── App.tsx              # Mode router
├── RoomSetup/
│   ├── index.tsx        # Topic/level selection → create room
│   └── TopicCard.tsx    # Individual topic option
├── GameSession/
│   ├── index.tsx        # Main game container
│   ├── RecordingPanel.tsx   # Mic button, phase indicator, waveform
│   ├── ConversationView.tsx # Turn history + pending overlay
│   ├── CurrentPrompt.tsx    # What user should respond to
│   ├── ScoreDisplay.tsx     # Running score
│   └── ConnectionStatus.tsx # Sync indicator, reconnect button
├── GameComplete/
│   ├── index.tsx        # Final results
│   └── ScoreSummary.tsx # Breakdown of performance
└── shared/
    ├── AsyncButton.tsx  # Loading states (uses Result.isWaiting)
    ├── StatusBadge.tsx  # Connection, phase indicators
    ├── ErrorMessage.tsx # Consistent error display
    └── Waveform.tsx     # Audio visualization
```

## shadcn/ui Components

### Essential (install first)

```bash
bunx shadcn@latest init
bunx shadcn@latest add button card badge progress alert
```

| Component | Usage |
|-----------|-------|
| button | Mic, create room, submit |
| card | Topic selection, score display, conversation turns |
| badge | Connection status, phase indicators |
| progress | Model loading, recording duration |
| alert | Error states, warnings |

### Secondary (add as needed)

- dialog - Confirmations, settings
- select - Level picker (if not using cards)
- skeleton - Loading placeholders
- tooltip - Help text

### Custom Components (not shadcn)

- RecordingButton - Mic with phase-aware animation, speech probability indicator
- Waveform - Audio visualization during recording (uses speechProbabilityAtom)
- ConversationBubble - Player/NPC turn display

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        ATOMS LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  WebSocket ──► roomEventsAtom ──► roomStateAtom (Stream.scan)   │
│                          ├──► conversationHistoryAtom          │
│                          └──► scoreHistoryAtom                 │
│                                                                  │
│  VAD Service ──► vadEventAtom ────┐                             │
│               ──► speechProbAtom ─┤                             │
│  ASR Service ──► asrResultAtom ───┼──► recordingPhaseAtom       │
│  Model Load ──► modelLoadingAtom ─┘    (Atom.readable)          │
│                                                                  │
│  submitTurnFn ──► submitTurnResult ──► uploadAudioFn ──► AudioUploaded
│       └──► pendingTurnsOptimisticAtom (UI overlay only)         │
│                                                                  │
│  connectionStatusAtom + syncStateAtom + modelStatusAtom         │
│                    └──► appReadyAtom                            │
│                                                                  │
│  Atom.runtime.fn: createRoomFn, submitTurnFn, uploadAudioFn,   │
│                   preloadModelFn                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        HOOKS LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  useRoom()       → { roomId, state, conversation, ... }         │
│  useRecording()  → { phase, result, appReady, start, stop, ... }│
│  useTurn()       → { submitTurn, canSubmit, submitStatus,       │
│                      uploadStatus }                             │
│  useConnection() → { status, syncState, reconnect }             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     COMPONENTS LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  App ─┬─► RoomSetup (useRoom)                                   │
│       ├─► GameSession (useRoom, useRecording, useTurn)          │
│       │     ├─► RecordingPanel (useRecording)                   │
│       │     ├─► ConversationView (conversationWithPendingAtom)  │
│       │     ├─► ScoreDisplay (cumulativeScoreAtom)              │
│       │     └─► ConnectionStatus (useConnection)                │
│       └─► GameComplete (useRoom)                                │
└─────────────────────────────────────────────────────────────────┘
```

## Lifecycle & Architecture Invariants

### Invariant Compliance

| Invariant | How Addressed |
|-----------|---------------|
| #1 EventLog is source of truth | `roomStateAtom` derived from `roomEventsAtom` via Stream.scan |
| #2 All commands idempotent via requestId | requestId attached at ASR stop; used for submit + upload + create |
| #3 Event ordering | EventLogRemote replays from journal and server catch-up (no client-side mutation) |
| #4 Scoring runs in Queue Consumer | UI never blocks on scoring; ScoreUpdated arrives async via WebSocket |
| #5 No double-advance | `useTurn.canSubmit` + upload dedupe guard prevent repeat submits/uploads |
| #7 WebSocket validates session | Backend handles; frontend assumes authenticated connection |
| #8 Participant membership tracked in state | `roomStateAtom` includes participants; UI reads state.participants |
| #9 Scoring enqueue gated on AudioUploaded | uploadAudioFn chained after submitTurn; same requestId |
| #10 Room creation idempotent | `createRoomFn` uses requestId; retry-safe via backend idempotency |

### Connection Lifecycle

1. **App mount** → `roomIdAtom` reads URL param
2. **No roomId** → `RoomSetup` renders, user picks topic/level
3. **Create room** → `createRoomFn` fires, updates URL on success, `roomIdAtom` changes
4. **roomId exists** → WebSocket connects, events flow to `roomStateAtom`
5. **Connection drops** → `connectionStatusAtom` → "reconnecting", auto-retry with backoff
6. **Reconnect success** → EventLogRemote replays from journal + server catch-up, Stream.scan rebuilds state
7. **User leaves** → `useConnection` cleanup closes WebSocket

### Recording Lifecycle

1. **GameSession mount** → `preloadModelFn` fires in background
2. **Model downloads** → `modelLoadingAtom` tracks progress
3. **Model ready** → `recordingPhaseAtom` → "ready"
4. **User speaks** → VAD fires `SpeechStart` → phase → "listening"
5. **User stops** → VAD fires `SpeechEnd` → phase → "processing" → ASR runs
6. **Transcript ready** → `asrResultAtom` populated → phase → "result"
7. **Submit turn** → `submitTurnFn` with requestId → on success call `uploadAudioFn`
8. **AudioUploaded** → clear `asrResultAtom` after upload succeeds
9. **Component unmount** → `useRecording` cleanup stops any active recording

### Error Recovery

| Error | Detection | Recovery |
|-------|-----------|----------|
| Model load fails | `modelLoadingAtom.status === "error"` | Show retry button, call `preloadModelFn` again |
| Mic permission denied | `micPermissionAtom === "denied"` | Show permission instructions |
| Mic disconnect during recording | `MediaStreamTrack.onended` | Stop recording, surface error, allow restart |
| Tab backgrounded / AudioContext suspend | `visibilitychange` + `audioContext.state` | Pause VAD, resume on focus, show banner |
| VAD misfire / too-short speech | VAD callback or `durationMs < minSpeechMs` | Drop result, show hint, do not submit |
| WebSocket disconnected | `connectionStatusAtom === "disconnected"` | Auto-retry; show reconnect button after N failures |
| Turn submit fails | `Result.isFailure(submitResult)` | Show error, allow retry (requestId ensures idempotency) |
| Safari storage eviction | storage persist denied or cache miss | Re-download model, show warning |
| Audio upload fails | `Result.isFailure(uploadAudioResult)` | Retry with same `turnId` + `requestId`; show timeout after 30s |

## Implementation Notes

- Use Effect `Match` for all tag discrimination (no direct `._tag` access)
- Use `Atom.readable()` for pure derived atoms; use `Atom.make()` for Stream/Effect sources
- Use `get.streamResult(atom)` to lift `Atom<Result>` into a Stream when composing streams
- Use `Result.isWaiting()` for loading state (not `Result.isLoading()` - doesn't exist)
- Use `Atom.runtime(layer)` when an operation needs services (e.g. HttpClient)
- Use `Atom.optimistic` + `Atom.optimisticFn` for UI-only pending overlays (EventLog remains source of truth)
- Keep `requestId` until `AudioUploaded` succeeds; clear ASR after upload completes
- Gate recording/submit actions via `appReadyAtom`
- Components never import atoms directly - only via hooks
- Each mode folder is self-contained; children don't reach outside except to `shared/`
- shadcn components go in `components/ui/`, feature components in `components/`

## Useful Effect-Atom Utilities

| Utility | Use Case |
|---------|----------|
| `Atom.readable((get) => ...)` | Derived atoms that read other atoms |
| `Atom.map(fn)` | Simple value transformation (pipe-able) |
| `Atom.transform((get) => ...)` | Derived atom via pipe syntax |
| `Atom.debounce(duration)` | Debounce reactive values |
| `Atom.family((param) => ...)` | Parameterized atoms (per-room, per-turn) |
| `Atom.runtime.fn(effect)` | Async operations returning Result |
| `Atom.fnSync(fn)` | Synchronous operations |
| `Atom.optimistic` | UI-only overlay for pending state |
| `Atom.optimisticFn` | Optimistic async operations with reducers |

## Migration Strategy

1. Install shadcn/ui + Tailwind
2. Create atom files (refactor from existing, fix API usage)
3. Create hooks (new layer, with cleanup)
4. Build components incrementally (RoomSetup first)
5. Add ConnectionStatus indicator + appReady gating
6. Wire up RecordingPanel with VAD integration + audio upload chain
7. Integrate pending turn overlay in ConversationView
8. Delete old frontend.tsx when complete

## Open Questions

- Waveform visualization library choice (wavesurfer.js vs custom canvas using speechProbabilityAtom?)
- Animation library for RecordingButton (framer-motion vs CSS?)
- Testing strategy for hooks (@effect/vitest patterns for effect-atom?)

## Research Addendum (2026-01-17)

### Validated Patterns

- `Stream.scan` works as `Stream.scan(events, initial, reducer)` (or `events.pipe(Stream.scan(initial, reducer))`)
- `SubscriptionRef.make()` with `.changes` is the right primitive for shared WebSocket status
- `Match.exhaustive` with `Data.taggedEnum` is correct for VAD events

### Recommendations Incorporated

- `appReadyAtom` added to coordinate model + connection + sync readiness
- `pendingTurnsOptimisticAtom` + `submitTurnOptimistic` added for UI-only pending overlays
- Explicit submit→upload chaining added for invariant #9 (requestId preserved through upload)
- VAD tuning + edge-case handling captured in Error Recovery table
- Keep derived-atom recording logic for now; revisit `Machine` only if state becomes complex

### Notes / Corrections

- `Atom.readable` is for pure derived values; Stream/Effect sources must be run via `Atom.make` (or an `Atom.runtime`)
- Use `get.streamResult` when composing Streams from `Atom<Result>`
- Stream composition alternatives like `Stream.zipLatestAll` are optional if you stay in Stream land
- Decision: rely on EventLogRemote replay + journal catch-up; RoomSnapshot requires backend support

### Updated Review Findings (post-update)

- High: Ensure audio upload is always triggered after submit success and deduped per turnId
- Medium: Clear pending overlays when matching `TurnAccepted` arrives (requestId match)
- Low: Confirm EventLogRemote replay behavior in production (no snapshot today)

## Review Checklist

- [x] API audit: Atom.derived → Atom.readable
- [x] API audit: Result.isLoading → Result.isWaiting
- [x] API audit: Atom.runtime usage corrected
- [x] Architecture: Invariant #10 room creation retry documented
- [x] Architecture: Invariant #5 double-submit prevention in useTurn
- [x] Architecture: Invariant #3 event ordering via EventLogRemote replay
- [x] Architecture: Invariant #9 audio upload chained after submitTurn
- [x] Coordination: appReadyAtom gating added
- [x] Optimistic UI: pendingTurns overlay + submitTurnOptimistic added
- [x] Gap: VAD event integration added (vadEventAtom, speechProbabilityAtom)
- [x] Gap: Recording duration/timeout added (recordingMetricsAtom, shouldAutoStopAtom)
- [x] Gap: Reconnection recovery added (syncStateAtom, reconnectFn, ConnectionStatus)
- [x] Gap: Model loading progress added (ModelLoadingState with downloadProgress)
- [x] Gap: Score derived atoms added (scoreHistoryAtom, cumulativeScoreAtom)
- [x] Gap: Conversation derived atoms added (playerTurnsAtom, currentPromptAtom)
