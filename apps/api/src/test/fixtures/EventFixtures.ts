/**
 * EventFixtures - Type-safe fixture builders for RoomEventGroup payloads.
 *
 * Uses Schema.Class directly so compile errors occur if schemas change.
 * @see apps/api/src/domain/RoomEventGroup.ts
 */
import {
  TurnAcceptedPayload,
  ScoreUpdatedPayload,
  NpcTurnGeneratedPayload,
  TurnAdvancedPayload,
  PlayerJoinedPayload,
  PlayerDisconnectedPayload,
  RoomCompletedPayload,
  RoomErrorPayload,
  RoomInitializedPayload,
  AudioUploadedPayload
} from "../../domain/RoomEventGroup";

// =============================================================================
// Helper: Timestamp generation
// =============================================================================

const now = () => Date.now();

// =============================================================================
// RoomInitialized Fixtures
// =============================================================================

export const RoomInitializedFixtures = {
  defaults: {
    roomId: "room-test",
    scenarioId: "tpl-test",
    seedPrompt: "Hola, bienvenido.",
    topic: "travel",
    level: "A2",
    timestamp: now()
  },

  make: (overrides: Partial<typeof RoomInitializedFixtures.defaults> = {}) =>
    new RoomInitializedPayload({ ...RoomInitializedFixtures.defaults, ...overrides }),

  /** Room initialized for specific topic/level */
  forTopicLevel: (roomId: string, topic: string, level: string, seedPrompt: string) =>
    RoomInitializedFixtures.make({
      roomId,
      scenarioId: `tpl-${topic}-${level.toLowerCase()}`,
      topic,
      level,
      seedPrompt,
      timestamp: now()
    })
};

// =============================================================================
// TurnAccepted Fixtures
// =============================================================================

export const TurnAcceptedFixtures = {
  defaults: {
    roomId: "room-test",
    turnId: "turn-test",
    playerId: "user-test",
    transcript: "Hola, quiero un billete de ida.",
    timestamp: now()
  },

  make: (overrides: Partial<typeof TurnAcceptedFixtures.defaults> = {}) =>
    new TurnAcceptedPayload({ ...TurnAcceptedFixtures.defaults, ...overrides }),

  /** Turn accepted in specific room */
  inRoom: (roomId: string, turnId: string, transcript: string) =>
    TurnAcceptedFixtures.make({
      roomId,
      turnId,
      transcript,
      timestamp: now()
    })
};

// =============================================================================
// ScoreUpdated Fixtures
// =============================================================================

export const ScoreUpdatedFixtures = {
  defaults: {
    roomId: "room-test",
    turnId: "turn-test",
    scores: {
      fluency: 75,
      vocab: 80,
      naturalness: 70
    },
    overallScore: 75,
    feedback: ["Good vocabulary usage", "Work on fluency"],
    nextPrompt: "Muy bien. ¿De dónde sale el tren?",
    modelVersion: "v1.0.0",
    confidence: 0.85
  },

  make: (overrides: Partial<typeof ScoreUpdatedFixtures.defaults> = {}) =>
    new ScoreUpdatedPayload({ ...ScoreUpdatedFixtures.defaults, ...overrides }),

  /** High score result */
  highScore: (roomId: string, turnId: string) =>
    ScoreUpdatedFixtures.make({
      roomId,
      turnId,
      scores: { fluency: 95, vocab: 92, naturalness: 90 },
      overallScore: 92,
      feedback: ["Excellent fluency!", "Great vocabulary"],
      confidence: 0.95
    }),

  /** Low score result */
  lowScore: (roomId: string, turnId: string) =>
    ScoreUpdatedFixtures.make({
      roomId,
      turnId,
      scores: { fluency: 45, vocab: 50, naturalness: 40 },
      overallScore: 45,
      feedback: ["Practice more with common phrases", "Work on pronunciation"],
      confidence: 0.7
    }),

  /** Score with custom values */
  withScores: (
    roomId: string,
    turnId: string,
    fluency: number,
    vocab: number,
    naturalness: number
  ) => {
    const overall = Math.round((fluency * 0.4 + vocab * 0.3 + naturalness * 0.3));
    return ScoreUpdatedFixtures.make({
      roomId,
      turnId,
      scores: { fluency, vocab, naturalness },
      overallScore: overall
    });
  }
};

// =============================================================================
// AudioUploaded Fixtures
// =============================================================================

export const AudioUploadedFixtures = {
  defaults: {
    roomId: "room-test",
    turnId: "turn-test",
    audioKey: "turns/turn-test/audio.webm",
    requestId: "req-test",
    fileSizeBytes: 15000,
    timestamp: now()
  },

  make: (overrides: Partial<typeof AudioUploadedFixtures.defaults> = {}) =>
    new AudioUploadedPayload({ ...AudioUploadedFixtures.defaults, ...overrides }),

  /** Audio uploaded for specific turn */
  forTurn: (roomId: string, turnId: string, requestId: string = crypto.randomUUID()) =>
    AudioUploadedFixtures.make({
      roomId,
      turnId,
      audioKey: `turns/${turnId}/audio.webm`,
      requestId,
      timestamp: now()
    }),

  /** Audio with duration metadata */
  withDuration: (roomId: string, turnId: string, durationMs: number) =>
    AudioUploadedFixtures.make({
      roomId,
      turnId,
      audioKey: `turns/${turnId}/audio.webm`,
      requestId: crypto.randomUUID(),
      durationMs,
      timestamp: now()
    })
};

// =============================================================================
// NpcTurnGenerated Fixtures
// =============================================================================

export const NpcTurnGeneratedFixtures = {
  defaults: {
    roomId: "room-test",
    turnId: "turn-npc-test",
    npcId: "npc-guide",
    content: "Muy bien. ¿A qué hora quiere salir?",
    stepIndex: 1,
    timestamp: now()
  },

  make: (overrides: Partial<typeof NpcTurnGeneratedFixtures.defaults> = {}) =>
    new NpcTurnGeneratedPayload({ ...NpcTurnGeneratedFixtures.defaults, ...overrides }),

  /** NPC response at specific step */
  atStep: (roomId: string, stepIndex: number, content: string) =>
    NpcTurnGeneratedFixtures.make({
      roomId,
      turnId: `turn-npc-${roomId}-${stepIndex}`,
      stepIndex,
      content,
      timestamp: now()
    })
};

// =============================================================================
// TurnAdvanced Fixtures
// =============================================================================

export const TurnAdvancedFixtures = {
  defaults: {
    roomId: "room-test",
    fromStepIndex: 0,
    toStepIndex: 1,
    nextParticipantType: "NPC" as const,
    nextParticipantId: "npc-guide"
  },

  make: (overrides: Partial<typeof TurnAdvancedFixtures.defaults> = {}) =>
    new TurnAdvancedPayload({ ...TurnAdvancedFixtures.defaults, ...overrides }),

  /** Advance to player's turn */
  toPlayer: (roomId: string, fromStep: number, playerId: string) =>
    TurnAdvancedFixtures.make({
      roomId,
      fromStepIndex: fromStep,
      toStepIndex: fromStep + 1,
      nextParticipantType: "Player",
      nextParticipantId: playerId
    }),

  /** Advance to NPC's turn */
  toNpc: (roomId: string, fromStep: number, npcId: string = "npc-guide") =>
    TurnAdvancedFixtures.make({
      roomId,
      fromStepIndex: fromStep,
      toStepIndex: fromStep + 1,
      nextParticipantType: "NPC",
      nextParticipantId: npcId
    })
};

// =============================================================================
// PlayerJoined Fixtures
// =============================================================================

export const PlayerJoinedFixtures = {
  defaults: {
    roomId: "room-test",
    playerId: "user-test",
    sessionId: "session-test",
    timestamp: now()
  },

  make: (overrides: Partial<typeof PlayerJoinedFixtures.defaults> = {}) =>
    new PlayerJoinedPayload({ ...PlayerJoinedFixtures.defaults, ...overrides }),

  /** Player joined specific room */
  inRoom: (roomId: string, playerId: string, sessionId: string = crypto.randomUUID()) =>
    PlayerJoinedFixtures.make({
      roomId,
      playerId,
      sessionId,
      timestamp: now()
    })
};

// =============================================================================
// PlayerDisconnected Fixtures
// =============================================================================

export const PlayerDisconnectedFixtures = {
  defaults: {
    roomId: "room-test",
    playerId: "user-test",
    sessionId: "session-test",
    timestamp: now()
  },

  make: (overrides: Partial<typeof PlayerDisconnectedFixtures.defaults> = {}) =>
    new PlayerDisconnectedPayload({ ...PlayerDisconnectedFixtures.defaults, ...overrides }),

  /** Player disconnected from specific room */
  fromRoom: (roomId: string, playerId: string, sessionId: string) =>
    PlayerDisconnectedFixtures.make({
      roomId,
      playerId,
      sessionId,
      timestamp: now()
    })
};

// =============================================================================
// RoomCompleted Fixtures
// =============================================================================

export const RoomCompletedFixtures = {
  defaults: {
    roomId: "room-test",
    summary: "Conversation completed successfully. Great progress!",
    timestamp: now()
  },

  make: (overrides: Partial<typeof RoomCompletedFixtures.defaults> = {}) =>
    new RoomCompletedPayload({ ...RoomCompletedFixtures.defaults, ...overrides }),

  /** Room completed with summary */
  withSummary: (roomId: string, summary: string) =>
    RoomCompletedFixtures.make({
      roomId,
      summary,
      timestamp: now()
    })
};

// =============================================================================
// RoomError Fixtures
// =============================================================================

export const RoomErrorFixtures = {
  defaults: {
    roomId: "room-test",
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred",
    retryable: true,
    timestamp: now()
  },

  make: (overrides: Partial<typeof RoomErrorFixtures.defaults> = {}) =>
    new RoomErrorPayload({ ...RoomErrorFixtures.defaults, ...overrides }),

  /** Retryable error */
  retryable: (roomId: string, code: string, message: string) =>
    RoomErrorFixtures.make({
      roomId,
      code,
      message,
      retryable: true,
      timestamp: now()
    }),

  /** Non-retryable error */
  nonRetryable: (roomId: string, code: string, message: string) =>
    RoomErrorFixtures.make({
      roomId,
      code,
      message,
      retryable: false,
      timestamp: now()
    }),

  /** Common error types */
  scoringTimeout: (roomId: string) =>
    RoomErrorFixtures.retryable(roomId, "SCORING_TIMEOUT", "Scoring service timed out"),

  invalidTranscript: (roomId: string) =>
    RoomErrorFixtures.nonRetryable(roomId, "INVALID_TRANSCRIPT", "Transcript validation failed")
};
