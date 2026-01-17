/**
 * Seed module - Effect-native seed data for Ensayo Quest.
 *
 * This module provides type-safe, validated seed data operations
 * that replace the SQL-based db/seed.sql approach.
 */

// Error types
export { SeedValidationError, SeedDbError } from "./SeedError";

// Seed data
export {
  seedScenarios,
  validateSeedCompleteness,
  REQUIRED_TOPICS,
  REQUIRED_LEVELS,
  type SeedScenario
} from "./SeedData";

// Service
export { SeedService, SeedServiceLive, type SeedServiceApi } from "./SeedService";
