/**
 * LanguageReviewFactory - Config-driven layer selection using idiomatic Effect patterns.
 *
 * Uses `Effect.gen` + `Layer.unwrapEffect` pattern from Effect source:
 * - Layer.unwrapEffect: effect/src/internal/layer.ts:1212-1217
 * - Config-driven pattern: sql-pg/src/PgClient.ts:452-478
 *
 * @see ensayo_quest-ywv for implementation context
 */
import { Effect, Layer } from "effect";
import {
  LanguageReview,
  LanguageReviewError,
  type LanguageReviewService,
  type LanguageReviewOutput
} from "./LanguageReview";
import { LanguageReviewGoogleLive } from "./LanguageReviewGoogle";
import { Env } from "./Env";

/**
 * Valid modes for language review selection.
 * - "google": Use Google Gemini API (production)
 * - "mock": Use deterministic mock responses (integration tests)
 * - "disabled": Return errors (scoring will use fallback)
 */
export type LanguageReviewMode = "google" | "mock" | "disabled";

const isValidMode = (mode: string | undefined): mode is LanguageReviewMode =>
  mode === "google" || mode === "mock" || mode === "disabled";

/**
 * Mock implementation with deterministic responses for testing.
 * Returns consistent scores to verify scoring pipeline without external API calls.
 */
const mockLanguageReview: LanguageReviewService = {
  review: (input) =>
    Effect.succeed({
      subscores: {
        fluency: 70,
        vocab: 65,
        grammar: 75,
        relevance: 80,
        pronunciation: 60,
        naturalness: 72
      },
      feedback: {
        wins: ["Clear pronunciation", "Good vocabulary usage"],
        fixes: ["Consider varying sentence structure"]
      },
      correctedPhrases: [],
      nextPrompt: `Good work! Continue practicing ${input.language}.`,
      confidence: 0.85,
      modelVersion: "mock-v1"
    } satisfies LanguageReviewOutput)
};

/**
 * Disabled implementation that fails - scoring service will use fallback logic.
 */
const disabledLanguageReview: LanguageReviewService = {
  review: () => Effect.fail(new LanguageReviewError({ reason: "language_review_disabled" }))
};

/**
 * Config-driven LanguageReview layer selection.
 *
 * This is the idiomatic Effect pattern for dynamic layer composition:
 * 1. Effect.gen - reads mode from Cloudflare Env
 * 2. Switch on mode to select appropriate layer
 * 3. Layer.unwrapEffect - converts Effect<Layer> to Layer
 *
 * Reads directly from Cloudflare env (not Effect ConfigProvider) for consistency
 * with rest of codebase.
 *
 * @example
 * // Production (default)
 * LANGUAGE_REVIEW_MODE=google
 *
 * // Integration tests
 * LANGUAGE_REVIEW_MODE=mock
 *
 * // Disable scoring LLM
 * LANGUAGE_REVIEW_MODE=disabled
 */
export const LanguageReviewConfigurable = Effect.gen(function* () {
  const env = yield* Env;
  const rawMode = env.LANGUAGE_REVIEW_MODE?.trim();
  const mode: LanguageReviewMode = isValidMode(rawMode) ? rawMode : "google";

  yield* Effect.logInfo(`LanguageReview mode: ${mode}`);

  switch (mode) {
    case "google":
      // Validate API key is present for Google mode
      if (!env.GOOGLE_AI_API_KEY?.trim()) {
        yield* Effect.logWarning(
          "LANGUAGE_REVIEW_MODE=google but GOOGLE_AI_API_KEY not set, falling back to disabled"
        );
        return Layer.succeed(LanguageReview, disabledLanguageReview);
      }
      return LanguageReviewGoogleLive;

    case "mock":
      yield* Effect.logDebug("Using mock LanguageReview for testing");
      return Layer.succeed(LanguageReview, mockLanguageReview);

    case "disabled":
      yield* Effect.logDebug("LanguageReview disabled");
      return Layer.succeed(LanguageReview, disabledLanguageReview);
  }
}).pipe(Layer.unwrapEffect);
