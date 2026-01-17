/**
 * TurnFixtures - Type-safe fixture builders for TurnSubmission and related types.
 *
 * Uses Schema.Class directly so compile errors occur if schemas change.
 * @see apps/api/src/domain/TurnSubmission.ts
 */
import { TurnSubmission } from "../../domain/TurnSubmission";
import { QueueJob } from "../../domain/QueueJob";

// =============================================================================
// AudioStats Fixtures
// =============================================================================

/** AudioStats type matching TurnSubmission schema */
export type AudioStats = {
  totalMs: number;
  speechMs: number;
  silenceMs: number;
  segments: Array<{ startMs: number; endMs: number }>;
};

export const AudioStatsFixtures = {
  defaults: {
    totalMs: 3000,
    speechMs: 2500,
    silenceMs: 500,
    segments: [{ startMs: 0, endMs: 2500 }]
  } satisfies AudioStats,

  make: (overrides: Partial<AudioStats> = {}): AudioStats => ({
    ...AudioStatsFixtures.defaults,
    ...overrides
  }),

  /** Short utterance (~1 second) */
  short: (): AudioStats =>
    AudioStatsFixtures.make({
      totalMs: 1200,
      speechMs: 1000,
      silenceMs: 200,
      segments: [{ startMs: 100, endMs: 1100 }]
    }),

  /** Medium utterance (~3 seconds) */
  medium: (): AudioStats =>
    AudioStatsFixtures.make({
      totalMs: 3500,
      speechMs: 3000,
      silenceMs: 500,
      segments: [{ startMs: 200, endMs: 3200 }]
    }),

  /** Long utterance (~10 seconds with pauses) */
  long: (): AudioStats =>
    AudioStatsFixtures.make({
      totalMs: 10000,
      speechMs: 8000,
      silenceMs: 2000,
      segments: [
        { startMs: 200, endMs: 3500 },
        { startMs: 4000, endMs: 7000 },
        { startMs: 7500, endMs: 9800 }
      ]
    }),

  /** Multiple segments with pauses */
  withPauses: (pauseCount: number = 2): AudioStats => {
    const segmentDuration = 2000;
    const pauseDuration = 500;
    const segments: Array<{ startMs: number; endMs: number }> = [];
    let currentMs = 0;

    for (let i = 0; i <= pauseCount; i++) {
      segments.push({
        startMs: currentMs,
        endMs: currentMs + segmentDuration
      });
      currentMs += segmentDuration + pauseDuration;
    }

    const totalMs = currentMs - pauseDuration;
    const speechMs = (pauseCount + 1) * segmentDuration;

    return {
      totalMs,
      speechMs,
      silenceMs: totalMs - speechMs,
      segments
    };
  },

  /** Empty/silent audio (edge case) */
  silent: (): AudioStats =>
    AudioStatsFixtures.make({
      totalMs: 1000,
      speechMs: 0,
      silenceMs: 1000,
      segments: []
    })
};

// =============================================================================
// TurnSubmission Fixtures
// =============================================================================

const TurnSubmissionDefaults = {
  roomId: "room-test",
  turnId: "turn-test",
  templateId: "tpl-test",
  turnIndex: 0,
  speakerUserId: "user-test",
  transcript: "Hola, quiero un billete de ida.",
  audioStats: AudioStatsFixtures.defaults
};

export const TurnSubmissionFixtures = {
  defaults: TurnSubmissionDefaults,

  make: (overrides: Partial<typeof TurnSubmissionDefaults> = {}) =>
    new TurnSubmission({ ...TurnSubmissionDefaults, ...overrides }),

  /** Generate unique IDs for testing */
  unique: (overrides: Partial<typeof TurnSubmissionDefaults> = {}) => {
    const uuid = crypto.randomUUID().slice(0, 8);
    return TurnSubmissionFixtures.make({
      roomId: `room-${uuid}`,
      turnId: `turn-${uuid}`,
      ...overrides
    });
  },

  /** Turn at specific index in a room */
  atIndex: (roomId: string, turnIndex: number, transcript: string = "Test transcript") =>
    TurnSubmissionFixtures.make({
      roomId,
      turnId: `turn-${roomId}-${turnIndex}`,
      turnIndex,
      transcript
    }),

  /** Turn with specific audio stats */
  withAudio: (audioStats: AudioStats) =>
    TurnSubmissionFixtures.make({ audioStats }),

  /** Short response turn */
  shortResponse: () =>
    TurnSubmissionFixtures.make({
      transcript: "Sí, por favor.",
      audioStats: AudioStatsFixtures.short()
    }),

  /** Long response turn */
  longResponse: () =>
    TurnSubmissionFixtures.make({
      transcript:
        "Quiero reservar una mesa para cuatro personas para esta noche a las ocho. También me gustaría saber si tienen opciones vegetarianas en el menú.",
      audioStats: AudioStatsFixtures.long()
    }),

  // -------------------------------------------------------------------------
  // Topic-specific transcripts
  // -------------------------------------------------------------------------

  /** Travel-themed transcript */
  travel: () =>
    TurnSubmissionFixtures.make({
      templateId: "tpl-travel-a2",
      transcript: "Buenos días. Quiero comprar un billete de ida a Madrid."
    }),

  /** Food-themed transcript */
  food: () =>
    TurnSubmissionFixtures.make({
      templateId: "tpl-food-a2",
      transcript: "Me gustaría ver el menú, por favor. ¿Qué plato del día tienen?"
    }),

  /** Work-themed transcript */
  work: () =>
    TurnSubmissionFixtures.make({
      templateId: "tpl-work-a2",
      transcript: "El proyecto va bien. Tenemos una reunión mañana para revisar los avances."
    }),

  /** Hobbies-themed transcript */
  hobbies: () =>
    TurnSubmissionFixtures.make({
      templateId: "tpl-hobbies-a2",
      transcript: "Me gusta mucho el fútbol. Los fines de semana juego con mis amigos."
    })
};

// =============================================================================
// QueueJob Fixtures
// =============================================================================

const QueueJobDefaults: {
  roomId: string;
  turnId: string;
  status: "partial" | "final";
} = {
  roomId: "room-test",
  turnId: "turn-test",
  status: "final"
};

export const QueueJobFixtures = {
  defaults: QueueJobDefaults,

  make: (overrides: Partial<typeof QueueJobDefaults> = {}) =>
    new QueueJob({ ...QueueJobDefaults, ...overrides }),

  /** Final status - ready for scoring */
  final: (roomId: string, turnId: string) =>
    QueueJobFixtures.make({ roomId, turnId, status: "final" }),

  /** Partial status - audio not yet uploaded */
  partial: (roomId: string, turnId: string) =>
    QueueJobFixtures.make({ roomId, turnId, status: "partial" }),

  /** Generate from TurnSubmission */
  fromTurn: (turn: TurnSubmission, status: "partial" | "final" = "final") =>
    QueueJobFixtures.make({
      roomId: turn.roomId,
      turnId: turn.turnId,
      status
    })
};
