# Frontend State & Components Design

## Overview

Refactor the monolithic `frontend.tsx` into a declarative, mode-based component architecture using:
- **@effect-atom/atom-react** for reactive state management
- **shadcn/ui + Tailwind** for accessible UI components
- **Composite hooks** as the "fool proof" API layer
- **Derived atoms** for composed state (Effect-native patterns)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI Library | shadcn/ui + Tailwind | Accessible primitives, components in codebase, full control |
| Atom Organization | Flat with naming conventions | Simple navigation, conventions enforce separation |
| Component Structure | Mode-based (horizontal slices) | Clear sequential flow: Setup → Playing → Complete |
| Hook Pattern | Composite hooks per feature | Clean API, hides atom coordination, handles cleanup |
| Loading/Error | Declarative wrapper components | Consistent UX, components focus on happy path |
| Recording State | Derived atoms with composition | Effect-native, granular testing, automatic reactivity |

## Atom Structure

```
apps/web/atoms/
├── room.ts              # Event-sourced room state
├── room.ops.ts          # Room operations (create, join)
├── recording.ts         # Model, VAD, ASR atoms
├── recording.ops.ts     # Recording operations (preload, start, stop)
├── recording.derived.ts # Composed recording state
└── connection.ts        # WebSocket status, reconnection
```

### Naming Conventions

- `*Atom` suffix for reactive state: `roomStateAtom`, `modelStatusAtom`
- `*Fn` suffix for operations: `createRoomFn`, `preloadModelFn`
- `.derived.ts` files for composed atoms that depend on others

### Event-Sourced Atoms (survive refresh)

```typescript
// atoms/room.ts
export const roomIdAtom = Atom.searchParam("roomId");
export const roomEventsAtom = // WebSocket stream
export const roomStateAtom = // Stream.scan of roomEventsAtom
export const connectionStatusAtom = // WebSocket lifecycle
```

### Transient Atoms (ephemeral UI state)

```typescript
// atoms/recording.ts
export const modelStatusAtom = Atom.make<ModelStatus>("idle");
export const vadEventAtom = Atom.make<VadEvent | null>(null);
export const asrResultAtom = Atom.make<AsrResult | null>(null);

type ModelStatus = "idle" | "loading" | "ready" | "error";
type VadEvent =
  | Data.TaggedEnum.Value<"SpeechStart">
  | Data.TaggedEnum.Value<"SpeechEnd", { audio: Float32Array }>;
type AsrResult = { transcript: string; requestId: string };
```

### Derived Atoms (composed state)

```typescript
// atoms/recording.derived.ts
import { Match } from "effect";

export type RecordingPhase =
  | "not_ready"   // model not loaded
  | "ready"       // model loaded, waiting for speech
  | "listening"   // VAD detected speech start
  | "processing"  // speech ended, ASR running
  | "result"      // transcript available
  | "error";

export const recordingPhaseAtom = Atom.derived((get) => {
  const model = get(modelStatusAtom);
  const vad = get(vadEventAtom);
  const asr = get(asrResultAtom);

  if (model !== "ready") return model === "loading" ? "not_ready" : model;
  if (asr) return "result";
  if (!vad) return "ready";

  return Match.value(vad).pipe(
    Match.tag("SpeechEnd", () => "processing" as const),
    Match.tag("SpeechStart", () => "listening" as const),
    Match.exhaustive
  );
});
```

### Operation Atoms (Atom.fn / Atom.runtime)

```typescript
// atoms/room.ops.ts
const httpRuntime = Atom.runtime(FetchHttpClient.layer);

export const createRoomFn = httpRuntime.fn<CreateRoomInput>()(
  Effect.fnUntraced(function* (input) {
    // POST /api/rooms
    // Update URL on success
  })
);

export const submitTurnFn = httpRuntime.fn<SubmitTurnInput>()(
  Effect.fnUntraced(function* (input) {
    // POST /api/rooms/{roomId}/turns
  })
);
```

## Composite Hooks

Hooks wrap atoms into clean component APIs with automatic cleanup.

### useRoom

```typescript
// hooks/useRoom.ts
export function useRoom() {
  const roomId = useAtomValue(roomIdAtom);
  const state = useAtomValue(roomStateAtom);
  const connection = useAtomValue(connectionStatusAtom);

  const create = useAtomSet(createRoomFn);
  const createResult = useAtomValue(createRoomFn);

  return {
    roomId,
    state,
    connection,
    create,
    createStatus: Result.isLoading(createResult) ? "pending"
                : Result.isSuccess(createResult) ? "success"
                : Result.isFailure(createResult) ? "error"
                : "idle",
    createError: Result.isFailure(createResult)
                  ? createResult.error : null
  };
}
```

### useRecording

```typescript
// hooks/useRecording.ts
export function useRecording() {
  const phase = useAtomValue(recordingPhaseAtom);
  const result = useAtomValue(asrResultAtom);

  const preload = useAtomSet(preloadModelFn);
  const start = useAtomSet(startRecordingFn);
  const stop = useAtomSet(stopRecordingFn);

  // Cleanup on unmount
  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { phase, result, preload, start, stop };
}
```

### useTurn

```typescript
// hooks/useTurn.ts
export function useTurn() {
  const { state } = useRoom();
  const submit = useAtomSet(submitTurnFn);
  const submitResult = useAtomValue(submitTurnFn);

  return {
    currentTurn: state?.currentTurn,
    submit,
    submitStatus: // derive from Result
  };
}
```

## Component Structure

### Mode-Based Routing

```typescript
// components/App.tsx
export function App() {
  const { roomId, state } = useRoom();

  return Match.value({ roomId, status: state?.status }).pipe(
    Match.when({ roomId: Match.undefined }, () => <RoomSetup />),
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
│   └── ScoreDisplay.tsx     # Running score
├── GameComplete/
│   ├── index.tsx        # Final results
│   └── ScoreSummary.tsx # Breakdown of performance
└── shared/
    ├── AsyncButton.tsx  # Loading states
    ├── StatusBadge.tsx  # Connection, phase indicators
    └── ErrorMessage.tsx # Consistent error display
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

- RecordingButton - Mic with phase-aware animation
- Waveform - Audio visualization during recording
- ConversationBubble - Player/NPC turn display

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        ATOMS LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  WebSocket ──► roomEventsAtom ──► roomStateAtom (Stream.scan)   │
│                                                                  │
│  VAD Service ──► vadEventAtom ─┐                                │
│  ASR Service ──► asrResultAtom ─┼──► recordingPhaseAtom (derived)│
│  Model Load ──► modelStatusAtom─┘                                │
│                                                                  │
│  Atom.fn ops: createRoomFn, submitTurnFn, preloadModelFn        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        HOOKS LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  useRoom()      → { roomId, state, create, createStatus }       │
│  useRecording() → { phase, result, preload, start, stop }       │
│  useTurn()      → { submit, submitStatus, currentTurn }         │
│  useConnection()→ { status, reconnect }                         │
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
│       │     └─► ScoreDisplay (useRoom.state.scores)             │
│       └─► GameComplete (useRoom)                                │
└─────────────────────────────────────────────────────────────────┘
```

## Lifecycle

1. **App mount** → `roomIdAtom` reads URL param
2. **No roomId** → `RoomSetup` renders, user picks topic/level
3. **Create room** → `createRoomFn` fires, updates URL on success
4. **roomId exists** → WebSocket connects, events flow to `roomStateAtom`
5. **GameSession** → `preloadModelFn` fires, model loads in background
6. **User speaks** → VAD detects → ASR processes → `asrResultAtom` updates
7. **Submit turn** → `submitTurnFn` fires with requestId from `asrResultAtom`
8. **Score arrives** → WebSocket event → `roomStateAtom` updates → UI reacts
9. **Cleanup** → Hooks handle unmount cleanup. WebSocket closes when no atoms subscribe.

## Implementation Notes

- Use Effect `Match` for all tag discrimination (no direct `._tag` access)
- Components never import atoms directly - only via hooks
- Each mode folder is self-contained; children don't reach outside except to `shared/`
- shadcn components go in `components/ui/`, feature components in `components/`

## Migration Strategy

1. Install shadcn/ui + Tailwind
2. Create atom files (refactor from existing)
3. Create hooks (new layer)
4. Build components incrementally (RoomSetup first)
5. Delete old frontend.tsx when complete

## Open Questions

- Waveform visualization library choice (wavesurfer.js vs custom canvas?)
- Animation library for RecordingButton (framer-motion vs CSS?)
- Testing strategy for hooks (effect-atom test utilities?)
