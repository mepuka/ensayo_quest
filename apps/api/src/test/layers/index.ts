/**
 * Test Layers - Barrel exports for reusable test layers.
 *
 * These layers provide Effect-native mocking for services, enabling
 * fast, isolated tests without Cloudflare runtime dependencies.
 *
 * @example
 * ```ts
 * import {
 *   makeDbTestState,
 *   makeDbTestLayer,
 *   makeScoringTestLayer,
 *   makeRoomDoTestLayer,
 *   makeFullTestLayer
 * } from "../../test/layers";
 *
 * const state = makeDbTestState();
 * const layer = makeFullTestLayer({ dbState: state });
 * ```
 */

// Db test layer
export {
  makeDbTestState,
  makeDbTestLayer,
  makeDbTestLayerSeeded,
  createSeededDbTest,
  type DbTestState
} from "./DbTestLayer";

// ScoringService test layer
export {
  makeScoringTestLayer,
  ScoringTestLayerHighScore,
  ScoringTestLayerLowScore,
  ScoringTestLayerDefault,
  type ScoringTestConfig
} from "./ScoringTestLayer";

// RoomDoClient test layer
export {
  makeRoomDoTestLayer,
  RoomDoTestLayerDefault,
  RoomDoTestLayerFailing,
  type RoomDoTestConfig
} from "./RoomDoTestLayer";

// =============================================================================
// Composite Layer Factory
// =============================================================================

import { Layer } from "effect";
import { makeDbTestState, makeDbTestLayer, type DbTestState } from "./DbTestLayer";
import { makeScoringTestLayer, type ScoringTestConfig } from "./ScoringTestLayer";
import { makeRoomDoTestLayer, type RoomDoTestConfig } from "./RoomDoTestLayer";
import { RoomIdGenerator } from "../../services/RoomIdGenerator";
import { Turnstile } from "../../security/Turnstile";
import { Effect } from "effect";
import type { SeedScenario } from "../../seed/SeedData";

export interface FullTestLayerConfig {
  dbState?: DbTestState;
  scoringConfig?: ScoringTestConfig;
  roomDoConfig?: RoomDoTestConfig;
  /** If true, pre-seed scenarios from SeedData */
  seeded?: boolean;
}

/**
 * Create a composite layer with all common test dependencies.
 *
 * Includes:
 * - Db (in-memory)
 * - ScoringService (mock)
 * - RoomDoClient (mock)
 * - RoomIdGenerator (deterministic)
 * - Turnstile (always passes)
 */
export const makeFullTestLayer = (config: FullTestLayerConfig = {}) => {
  const { dbState, scoringConfig, roomDoConfig, seeded = false } = config;

  // Create or use provided state
  const state = dbState ?? makeDbTestState();

  // Optionally seed scenarios
  if (seeded) {
    const { seedScenarios } = require("../../seed/SeedData");
    seedScenarios.forEach((s: SeedScenario) =>
      state.scenarios.set(s.template.templateId, s.template)
    );
  }

  return Layer.mergeAll(
    makeDbTestLayer(state),
    makeScoringTestLayer(scoringConfig),
    makeRoomDoTestLayer(roomDoConfig),
    Layer.succeed(RoomIdGenerator, {
      generate: Effect.sync(() => `test-room-${crypto.randomUUID().slice(0, 8)}`)
    }),
    Layer.succeed(Turnstile, {
      verifyToken: () => Effect.succeed(true)
    })
  );
};
