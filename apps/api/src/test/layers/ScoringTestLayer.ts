/**
 * ScoringTestLayer - Mock ScoringService for testing.
 *
 * Provides configurable mock scoring with callback hooks for assertions.
 *
 * @example
 * ```ts
 * const evaluatedInputs: TurnScoringInput[] = [];
 * const layer = makeScoringTestLayer({
 *   mockScore: 85,
 *   onEvaluate: (input) => evaluatedInputs.push(input)
 * });
 * ```
 */
import { Effect, Layer } from "effect";
import { ScoringService, type TurnScoringInput } from "../../services/ScoringService";
import { TurnEvaluation } from "../../domain/RoomProtocol";

// =============================================================================
// Configuration
// =============================================================================

export interface ScoringTestConfig {
  /** Overall score to return (default: 75) */
  mockScore?: number;
  /** Individual scores (default: derived from mockScore) */
  mockScores?: {
    fluency: number;
    vocab: number;
    naturalness: number;
  };
  /** Feedback strings to return */
  feedback?: string[];
  /** Next prompt to return */
  nextPrompt?: string;
  /** Model version string */
  modelVersion?: string;
  /** Confidence value (0-1) */
  confidence?: number;
  /** Callback when evaluate is called */
  onEvaluate?: (input: TurnScoringInput) => void;
}

// =============================================================================
// ScoringTestLayer Factory
// =============================================================================

/**
 * Create a ScoringService mock layer with configurable behavior.
 */
export const makeScoringTestLayer = (config: ScoringTestConfig = {}) => {
  const {
    mockScore = 75,
    mockScores,
    feedback = ["Mock feedback"],
    nextPrompt = "Mock next prompt",
    modelVersion = "mock-v1",
    confidence = 0.85,
    onEvaluate
  } = config;

  // Derive individual scores from overall if not provided
  const scores = mockScores ?? {
    fluency: mockScore + 5,
    vocab: mockScore - 5,
    naturalness: mockScore - 3
  };

  return Layer.succeed(ScoringService, {
    evaluate: (input: TurnScoringInput) =>
      Effect.sync(() => {
        // Call hook if provided
        onEvaluate?.(input);

        return new TurnEvaluation({
          turnId: input.turnId,
          scores,
          overallScore: mockScore,
          feedback,
          nextPrompt,
          modelVersion,
          confidence
        });
      })
  });
};

// =============================================================================
// Presets
// =============================================================================

/** High-score mock (90+) */
export const ScoringTestLayerHighScore = makeScoringTestLayer({
  mockScore: 92,
  mockScores: { fluency: 95, vocab: 90, naturalness: 88 },
  feedback: ["Excellent fluency!", "Great vocabulary usage"],
  confidence: 0.95
});

/** Low-score mock (below 50) */
export const ScoringTestLayerLowScore = makeScoringTestLayer({
  mockScore: 42,
  mockScores: { fluency: 40, vocab: 45, naturalness: 38 },
  feedback: ["Practice more with common phrases", "Work on pronunciation"],
  confidence: 0.7
});

/** Default mock (75) */
export const ScoringTestLayerDefault = makeScoringTestLayer();
