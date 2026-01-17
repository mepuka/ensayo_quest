/**
 * SeedError - Tagged error types for seed data operations.
 *
 * Uses Schema.TaggedError for proper error discrimination with catchTag.
 */
import * as Schema from "effect/Schema";

/**
 * Validation error when seed data is incomplete.
 * Contains list of missing topic/level combinations.
 */
export class SeedValidationError extends Schema.TaggedError<SeedValidationError>()(
  "SeedValidationError",
  {
    missing: Schema.Array(Schema.String)
  }
) {}

/**
 * Database error during seed operations.
 * Wraps underlying DB errors with context.
 */
export class SeedDbError extends Schema.TaggedError<SeedDbError>()(
  "SeedDbError",
  {
    reason: Schema.String,
    cause: Schema.optional(Schema.Unknown)
  }
) {}
