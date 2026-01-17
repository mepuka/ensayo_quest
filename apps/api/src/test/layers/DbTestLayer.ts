/**
 * DbTestLayer - In-memory Db mock for testing.
 *
 * Implements all 21 DbService methods with in-memory state for test isolation.
 * Uses `satisfies DbService` to ensure compile-time completeness.
 *
 * @example
 * ```ts
 * const state = makeDbTestState();
 * const layer = makeDbTestLayer(state);
 * // Run test with layer
 * // Inspect state.rooms, state.turns, etc. for assertions
 * ```
 */
import { Effect, Layer } from "effect";
import { Db, DbError, type DbService } from "../../services/Db";
import type { ScenarioTemplate } from "../../domain/ScenarioTemplate";
import type { TurnSubmission } from "../../domain/TurnSubmission";
import { seedScenarios } from "../../seed/SeedData";

// =============================================================================
// In-Memory State
// =============================================================================

/**
 * Create fresh in-memory state for test isolation.
 * Each test should call this to get independent state.
 */
export const makeDbTestState = () => ({
  scenarios: new Map<string, ScenarioTemplate>(),
  rooms: new Map<string, { templateId: string }>(),
  turns: new Map<string, TurnSubmission>(),
  scores: new Map<string, { overall: number; detailJson: string }>(),
  processedMessages: new Set<string>(),
  roomRequests: new Map<string, string>(), // requestId -> roomId
  turnRequests: new Map<string, string>(), // `${roomId}:${requestId}` -> turnId
  audioUploads: new Map<
    string,
    { audioKey: string; requestId: string; contentType: string | null; fileSizeBytes: number }
  >(), // turnId -> upload
  audioUploadRequests: new Map<string, string>() // `${turnId}:${requestId}` -> audioKey
});

export type DbTestState = ReturnType<typeof makeDbTestState>;

// =============================================================================
// DbTestLayer Factory
// =============================================================================

/**
 * Create a Db mock layer backed by in-memory state.
 * Implements all 21 DbService methods for complete test coverage.
 */
export const makeDbTestLayer = (state: DbTestState = makeDbTestState()) =>
  Layer.succeed(
    Db,
    {
      // Room operations
      createRoom: (roomId, templateId) =>
        Effect.sync(() => {
          state.rooms.set(roomId, { templateId });
        }),

      getRoomTemplateId: (roomId) => {
        const room = state.rooms.get(roomId);
        return room
          ? Effect.succeed(room.templateId)
          : Effect.fail(new DbError({ reason: "room_not_found" }));
      },

      // Turn operations
      insertTurn: (submission) =>
        Effect.sync(() => {
          state.turns.set(submission.turnId, submission);
        }),

      getTurnSubmission: (turnId) => {
        const turn = state.turns.get(turnId);
        return turn
          ? Effect.succeed(turn)
          : Effect.fail(new DbError({ reason: "turn_not_found" }));
      },

      getNextTurnIndex: (roomId) => {
        const count = [...state.turns.values()].filter((t) => t.roomId === roomId).length;
        return Effect.succeed(count);
      },

      updateTurnAudioKey: ({ turnId, audioKey }) =>
        Effect.sync(() => {
          const turn = state.turns.get(turnId);
          if (turn) {
            // TurnSubmission doesn't have audioKey, but we track it separately
            // This is a no-op for the in-memory mock since audioKey is on the turn row
          }
        }),

      updateTurnScore: (input) =>
        Effect.sync(() => {
          state.scores.set(input.turnId, {
            overall: input.overall,
            detailJson: input.detailJson
          });
        }),

      // Scenario template operations
      findScenarioTemplate: ({ topic, level }) => {
        for (const scenario of state.scenarios.values()) {
          if (scenario.topic === topic && scenario.level === level) {
            return Effect.succeed(scenario);
          }
        }
        return Effect.fail(new DbError({ reason: "scenario_not_found" }));
      },

      getScenarioTemplate: (templateId) => {
        const scenario = state.scenarios.get(templateId);
        return scenario
          ? Effect.succeed(scenario)
          : Effect.fail(new DbError({ reason: "scenario_not_found" }));
      },

      insertScenarioTemplate: ({ template, region, register }) =>
        Effect.sync(() => {
          state.scenarios.set(template.templateId, template);
        }),

      // Queue idempotency
      isMessageProcessed: (messageId) => Effect.succeed(state.processedMessages.has(messageId)),

      markMessageProcessed: (messageId) =>
        Effect.sync(() => {
          state.processedMessages.add(messageId);
        }),

      cleanupOldProcessedMessages: () => Effect.void,

      // Room request idempotency (Architecture Invariant #10)
      getRoomByRequestId: (requestId) =>
        Effect.succeed(state.roomRequests.get(requestId) ?? null),

      recordRoomRequest: (requestId, roomId) =>
        Effect.sync(() => {
          state.roomRequests.set(requestId, roomId);
        }),

      // Turn request idempotency
      getTurnByRequestId: (roomId, requestId) =>
        Effect.succeed(state.turnRequests.get(`${roomId}:${requestId}`) ?? null),

      recordTurnRequest: (roomId, requestId, turnId) =>
        Effect.sync(() => {
          state.turnRequests.set(`${roomId}:${requestId}`, turnId);
        }),

      // Audio upload idempotency (Architecture Invariant #9)
      getAudioUploadByTurnId: (turnId) => {
        const upload = state.audioUploads.get(turnId);
        return Effect.succeed(
          upload ? { audioKey: upload.audioKey, requestId: upload.requestId } : null
        );
      },

      getAudioUploadByRequestId: (turnId, requestId) => {
        const key = `${turnId}:${requestId}`;
        return Effect.succeed(state.audioUploadRequests.get(key) ?? null);
      },

      recordAudioUpload: (input) =>
        Effect.sync(() => {
          state.audioUploads.set(input.turnId, {
            audioKey: input.audioKey,
            requestId: input.requestId,
            contentType: input.contentType,
            fileSizeBytes: input.fileSizeBytes
          });
        }),

      recordAudioUploadRequest: (input) =>
        Effect.sync(() => {
          state.audioUploadRequests.set(`${input.turnId}:${input.requestId}`, input.audioKey);
        })
    } satisfies DbService
  );

// =============================================================================
// Preset: Seeded DbTestLayer
// =============================================================================

/**
 * DbTestLayer pre-seeded with all SeedData scenarios.
 * Useful for tests that need scenarios available.
 */
export const makeDbTestLayerSeeded = (state = makeDbTestState()) => {
  // Pre-populate scenarios from SeedData
  seedScenarios.forEach((s) => state.scenarios.set(s.template.templateId, s.template));
  return makeDbTestLayer(state);
};

/**
 * Convenience: Create seeded state and layer together.
 */
export const createSeededDbTest = () => {
  const state = makeDbTestState();
  seedScenarios.forEach((s) => state.scenarios.set(s.template.templateId, s.template));
  return { state, layer: makeDbTestLayer(state) };
};
