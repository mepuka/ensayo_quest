/**
 * Test Fixtures - Barrel exports for all fixture builders
 *
 * Import from this file for convenient access to all fixtures:
 * ```ts
 * import { ScenarioFixtures, TurnSubmissionFixtures } from "../../test/fixtures";
 * ```
 */

// Scenario-related fixtures
export {
  ScenarioFixtures,
  TurnPlanFixtures,
  RoleRubricFixtures
} from "./ScenarioFixtures";

// Turn-related fixtures
export {
  TurnSubmissionFixtures,
  AudioStatsFixtures,
  QueueJobFixtures,
  type AudioStats
} from "./TurnFixtures";

// Event payload fixtures
export {
  RoomInitializedFixtures,
  TurnAcceptedFixtures,
  ScoreUpdatedFixtures,
  AudioUploadedFixtures,
  NpcTurnGeneratedFixtures,
  TurnAdvancedFixtures,
  PlayerJoinedFixtures,
  PlayerDisconnectedFixtures,
  RoomCompletedFixtures,
  RoomErrorFixtures
} from "./EventFixtures";
