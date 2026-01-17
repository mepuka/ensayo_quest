/**
 * SeedService - Effect-native seed data service with idempotent application.
 *
 * Replaces SQL-based seeding with type-safe, validated Effect operations.
 */
import { Context, Effect, Layer } from "effect";
import { Db } from "../services/Db";
import { seedScenarios, validateSeedCompleteness, REQUIRED_TOPICS, REQUIRED_LEVELS } from "./SeedData";
import { SeedValidationError, SeedDbError } from "./SeedError";

// =============================================================================
// Service Interface
// =============================================================================

export interface SeedServiceApi {
  /**
   * Apply seed data to database using upsert semantics.
   * Validates completeness first, then upserts all scenarios (INSERT OR REPLACE).
   * Returns count of scenarios upserted.
   */
  apply: Effect.Effect<
    { upserted: number },
    SeedValidationError | SeedDbError
  >;

  /**
   * Verify seed data exists in database.
   * Returns true if all expected scenarios are present.
   */
  verify: Effect.Effect<boolean, SeedDbError>;
}

export class SeedService extends Context.Tag("SeedService")<
  SeedService,
  SeedServiceApi
>() {}

// =============================================================================
// Live Implementation
// =============================================================================

export const SeedServiceLive = Layer.effect(
  SeedService,
  Effect.gen(function* () {
    const db = yield* Db;

    return {
      apply: Effect.gen(function* () {
        // 1. Validate seed data completeness
        yield* validateSeedCompleteness;

        // 2. Upsert all scenarios (INSERT OR REPLACE)
        // This matches the CI SQL generation behavior
        let upserted = 0;

        for (const seed of seedScenarios) {
          yield* db
            .insertScenarioTemplate({
              template: seed.template,
              region: seed.region,
              register: seed.register
            })
            .pipe(
              Effect.mapError(
                (e) => new SeedDbError({ reason: e.reason, cause: e })
              )
            );
          upserted++;
        }

        return { upserted };
      }),

      verify: Effect.gen(function* () {
        const expected = REQUIRED_TOPICS.flatMap((topic) =>
          REQUIRED_LEVELS.map((level) => ({ topic, level }))
        );

        for (const { topic, level } of expected) {
          const exists = yield* db
            .findScenarioTemplate({ topic, level })
            .pipe(
              Effect.map(() => true),
              Effect.catchTag("DbError", (e) =>
                e.reason === "scenario_not_found"
                  ? Effect.succeed(false)
                  : Effect.fail(new SeedDbError({ reason: e.reason, cause: e }))
              )
            );

          if (!exists) {
            return false;
          }
        }

        return true;
      })
    };
  })
);
