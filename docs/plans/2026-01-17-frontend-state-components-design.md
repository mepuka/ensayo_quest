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
├── room.ops.ts          # Room operations (create, join)
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
import { Option } from "effect";

// URL param binding - returns Option when schema provided
export const roomIdAtom = Atom.searchParam("roomId");

// Event stream from WebSocket
export const roomEventsAtom = Atom.readable((get) => {
  const roomId = get(roomIdAtom);
  if (!roomId) return Stream.empty;
  return getOrCreateRoomConnection(roomId).events;
});

// Event-sourced projection via Stream.scan
export const roomStateAtom = Atom.readable((get) => {
  const events = get(roomEventsAtom);
  return events.pipe(
    Stream.scan(reduceRoomEvent, initialRoomState)
  );
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

### Connection & Sync State

```typescript
// atoms/connection.ts
import { Atom } from "@effect-atom/atom-react";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export const connectionStatusAtom = Atom.make<ConnectionStatus>("disconnected");

// Sync state for UI (show "syncing" indicator after reconnect)
export type SyncState = "synced" | "syncing" | "disconnected" | "stale";

export const syncStateAtom = Atom.readable((get) => {
  const conn = get(connectionStatusAtom);
  const room = get(roomStateAtom);

  if (conn === "disconnected" || conn === "error") return "disconnected" as const;
  if (conn === "reconnecting") return "syncing" as const;
  if (conn === "connected" && room) return "synced" as const;
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

### Conversation & Score Derived Atoms

```typescript
// atoms/conversation.ts
import { Atom } from "@effect-atom/atom-react";

export const conversationHistoryAtom = Atom.readable((get) => {
  const state = get(roomStateAtom);
  return state?.history ?? [];
});

export const playerTurnsAtom = conversationHistoryAtom.pipe(
  Atom.map((history) => history.filter(h => h.role === "player"))
);

export const npcTurnsAtom = conversationHistoryAtom.pipe(
  Atom.map((history) => history.filter(h => h.role === "npc"))
);

export const currentPromptAtom = Atom.readable((get) => {
  const state = get(roomStateAtom);
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

### Operation Atoms (Atom.runtime.fn)

```typescript
// atoms/room.ops.ts
import { Atom } from "@effect-atom/atom-react";
import { Effect } from "effect";

// Note: Atom.runtime is a singleton; use Atom.context() for custom layers
// For HTTP, we can use the default runtime with FetchHttpClient

export const createRoomFn = Atom.runtime.fn<CreateRoomInput>(
  Effect.fnUntraced(function* (input, get) {
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

export const submitTurnFn = Atom.runtime.fn<SubmitTurnInput>(
  Effect.fnUntraced(function* (input, get) {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

    const request = HttpClientRequest.post(`/api/rooms/${input.roomId}/turns`).pipe(
      HttpClientRequest.setHeader("Content-Type", "application/json"),
      HttpClientRequest.bodyText(JSON.stringify(input))
    );

    const response = yield* client.execute(request);
    return yield* HttpClientResponse.schemaBodyJson(SubmitTurnResponse)(response);
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

export function useRoom() {
  const roomId = useAtomValue(roomIdAtom);
  const state = useAtomValue(roomStateAtom);
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
import { useMemo, useCallback } from "react";

export function useTurn() {
  const { state, roomId } = useRoom();
  const { result: asrResult, clearResult } = useRecording();

  const submit = useAtomSet(submitTurnFn);
  const submitResult = useAtomValue(submitTurnFn);

  const submitStatus = Result.isWaiting(submitResult) ? "pending"
                     : Result.isSuccess(submitResult) ? "success"
                     : Result.isFailure(submitResult) ? "error"
                     : "idle";

  // Prevent double-submit: disabled when pending or no ASR result
  const canSubmit = submitStatus !== "pending"
                 && asrResult !== null
                 && state?.status === "playing";

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

    // Clear ASR result after submission
    clearResult();
  }, [canSubmit, asrResult, roomId, submit, clearResult]);

  return {
    currentPrompt: state?.currentPrompt,
    submitTurn,
    submitStatus,
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

export function useConnection() {
  const status = useAtomValue(connectionStatusAtom);
  const syncState = useAtomValue(syncStateAtom);
  const roomId = useAtomValue(roomIdAtom);
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
import { Match, Option } from "effect";

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
│   ├── ConversationView.tsx # Turn history (player + NPC)
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
│                                                                  │
│  VAD Service ──► vadEventAtom ────┐                             │
│               ──► speechProbAtom ─┤                             │
│  ASR Service ──► asrResultAtom ───┼──► recordingPhaseAtom       │
│  Model Load ──► modelLoadingAtom ─┘    (Atom.readable)          │
│                                                                  │
│  Atom.runtime.fn: createRoomFn, submitTurnFn, preloadModelFn   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        HOOKS LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  useRoom()       → { roomId, state, create, createStatus, ... } │
│  useRecording()  → { phase, result, start, stop, ... }          │
│  useTurn()       → { submitTurn, canSubmit, submitStatus }      │
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
│       │     ├─► ConversationView (useRoom.state.history)        │
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
| #2 All commands idempotent via requestId | `asrResultAtom` includes requestId, passed to `submitTurnFn` |
| #3 Event ordering | WebSocket delivers in order; reconnection triggers RoomSnapshot replay |
| #5 No double-advance | `useTurn.canSubmit` disables button during submission |
| #7 WebSocket validates session | Backend handles; frontend assumes authenticated connection |
| #10 Room creation idempotent | `createRoomFn` uses requestId; retry-safe via backend idempotency |

### Connection Lifecycle

1. **App mount** → `roomIdAtom` reads URL param
2. **No roomId** → `RoomSetup` renders, user picks topic/level
3. **Create room** → `createRoomFn` fires, updates URL on success, `roomIdAtom` changes
4. **roomId exists** → WebSocket connects, events flow to `roomStateAtom`
5. **Connection drops** → `connectionStatusAtom` → "reconnecting", auto-retry with backoff
6. **Reconnect success** → Server sends RoomSnapshot, Stream.scan rebuilds state
7. **User leaves** → `useConnection` cleanup closes WebSocket

### Recording Lifecycle

1. **GameSession mount** → `preloadModelFn` fires in background
2. **Model downloads** → `modelLoadingAtom` tracks progress
3. **Model ready** → `recordingPhaseAtom` → "ready"
4. **User speaks** → VAD fires `SpeechStart` → phase → "listening"
5. **User stops** → VAD fires `SpeechEnd` → phase → "processing" → ASR runs
6. **Transcript ready** → `asrResultAtom` populated → phase → "result"
7. **Submit turn** → `submitTurnFn` with requestId → clear `asrResultAtom`
8. **Component unmount** → `useRecording` cleanup stops any active recording

### Error Recovery

| Error | Detection | Recovery |
|-------|-----------|----------|
| Model load fails | `modelLoadingAtom.status === "error"` | Show retry button, call `preloadModelFn` again |
| Mic permission denied | `micPermissionAtom === "denied"` | Show permission instructions |
| WebSocket disconnected | `connectionStatusAtom === "disconnected"` | Auto-retry; show reconnect button after N failures |
| Turn submit fails | `Result.isFailure(submitResult)` | Show error, allow retry (requestId ensures idempotency) |
| Audio upload fails | Backend retries; frontend shows "uploading" until AudioUploaded event | Timeout after 30s, show error |

## Implementation Notes

- Use Effect `Match` for all tag discrimination (no direct `._tag` access)
- Use `Atom.readable()` for derived atoms (not `Atom.derived()` - doesn't exist)
- Use `Result.isWaiting()` for loading state (not `Result.isLoading()` - doesn't exist)
- Use `Atom.runtime` singleton for operations (not `Atom.runtime(layer)`)
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

## Migration Strategy

1. Install shadcn/ui + Tailwind
2. Create atom files (refactor from existing, fix API usage)
3. Create hooks (new layer, with cleanup)
4. Build components incrementally (RoomSetup first)
5. Add ConnectionStatus indicator
6. Wire up RecordingPanel with VAD integration
7. Delete old frontend.tsx when complete

## Open Questions

- Waveform visualization library choice (wavesurfer.js vs custom canvas using speechProbabilityAtom?)
- Animation library for RecordingButton (framer-motion vs CSS?)
- Testing strategy for hooks (@effect/vitest patterns for effect-atom?)

## Review Checklist

- [x] API audit: Atom.derived → Atom.readable
- [x] API audit: Result.isLoading → Result.isWaiting
- [x] API audit: Atom.runtime usage corrected
- [x] Architecture: Invariant #10 room creation retry documented
- [x] Architecture: Invariant #5 double-submit prevention in useTurn
- [x] Architecture: Invariant #3 event ordering via RoomSnapshot replay
- [x] Gap: VAD event integration added (vadEventAtom, speechProbabilityAtom)
- [x] Gap: Recording duration/timeout added (recordingMetricsAtom, shouldAutoStopAtom)
- [x] Gap: Reconnection recovery added (syncStateAtom, reconnectFn, ConnectionStatus)
- [x] Gap: Model loading progress added (ModelLoadingState with downloadProgress)
- [x] Gap: Score derived atoms added (scoreHistoryAtom, cumulativeScoreAtom)
- [x] Gap: Conversation derived atoms added (playerTurnsAtom, currentPromptAtom)
