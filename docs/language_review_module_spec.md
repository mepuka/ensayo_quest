# Language Review Module (LLM Prompting)

Status: Draft (near-production spec)

## Goal
Provide a pluggable, Effect-native module that evaluates learner language using LLM prompting. This module is designed to be provider-agnostic via `LanguageModel`, with a Google Gemini implementation using `@effect/ai-google`.

This module starts simple (transcript-based evaluation) and supports progressive enhancement (examples, rubric, structured outputs). It is intended to integrate with the scoring pipeline and return structured evaluation outputs.

## Research-Driven Prompting Requirements
Prompting patterns that improve reliability and consistency:
- Include explicit rubrics/criteria to reduce scoring variability. `docs/llm_language_review_research.md:72`
- Use few-shot examples to calibrate scoring and improve accuracy. `docs/llm_language_review_research.md:76`
- Request structured JSON output to keep responses parseable and consistent. `docs/llm_language_review_research.md:82`
- Use low temperature for deterministic output. `docs/llm_language_review_research.md:86`
- ASR transcripts are acceptable; assessment quality is preserved even with automatic transcripts. `docs/llm_language_review_research.md:60`

## Integration Points
- Scoring pipeline should call the language review module for feedback and naturalness. `apps/api/src/services/ScoringService.ts:83`
- `TurnEvaluation` includes scores, feedback, and `nextPrompt`. The module should map to this shape. `apps/shared/src/RoomProtocol.ts:4`

## API Design (Effect Services)

### 1) LanguageReview service
Effect service (Context.Tag) for provider-agnostic usage.

```ts
export type LanguageReviewInput = {
  mode: "spoken" | "written";
  language: "es" | "en" | string;
  transcript: string;
  audioFeatures?: { durationMs: number; pauseCount: number; speakingRateWpm: number };
  targetVocab?: Array<string>;
  objectives?: Array<{ id: string; description: string }>;
  rubric?: string;
  examples?: Array<{
    transcript: string;
    subscores: {
      fluency: number;
      vocab: number;
      grammar: number;
      relevance: number;
      pronunciation: number;
      naturalness: number;
    };
    rationale: string;
  }>;
};

export type LanguageReviewOutput = {
  subscores: {
    fluency: number;
    vocab: number;
    grammar: number;
    relevance: number;
    pronunciation: number;
    naturalness: number;
  };
  feedback: { wins: Array<string>; fixes: Array<string> };
  correctedPhrases: Array<{ original: string; improved: string; why: string }>;
  nextPrompt: string;
  confidence: number;
  modelVersion: string;
};
```

### 2) LanguageReviewConfig service
Config as a service (Context.Tag) to keep model policy outside implementation.

```ts
export type LanguageReviewConfig = {
  model: string;
  temperature: number;
  maxTokens: number;
  rubric: string;
  includeExamples: boolean;
  maxExamples: number;
  systemPrompt: string;
  promptVersion: string;
};
```

References: `effect/packages/effect/src/Context.ts:1`, `effect/packages/effect/src/Layer.ts:1`

## Provider Wiring (Google Gemini)

### LanguageModel provider (Google)
- `GoogleClient.layerConfig` provides client configuration (API key and URL). `node_modules/@effect/ai-google/src/GoogleClient.ts:192`
- `GoogleLanguageModel.layer` creates a `LanguageModel` service from Google. `node_modules/@effect/ai-google/src/GoogleLanguageModel.ts:245`

### LanguageModel usage
Use `LanguageModel.generateObject` for structured JSON output (schema-validated). `node_modules/@effect/ai/src/LanguageModel.ts:913`

## Prompt Template (MVP)
The module should compose a single system prompt and a single user prompt. Keep the system prompt stable and versioned.

System prompt (example):
```
You are a language assessment engine for learners.
Use the rubric to score and give feedback.
Return only JSON that matches the schema.
Do not include reasoning or hidden steps.
```

User prompt (example):
```
Rubric:
<rubric text>

Target vocab:
<comma-separated list>

Transcript:
<transcript>

Return JSON with keys:
subscores, feedback, correctedPhrases, nextPrompt, confidence, modelVersion
```

Research alignment: rubric, examples, structured output, low temperature. `docs/llm_language_review_research.md:72`

## Module Wiring (Effect)
Design the module with clear boundaries and Layer composition:

- `LanguageReview` depends on `LanguageModel` and `LanguageReviewConfig`.
- `LanguageReviewLive` uses `Effect.gen` for orchestration and `LanguageModel.generateObject` for structured output. `node_modules/@effect/ai/src/LanguageModel.ts:913`
- Use `Effect.fn` for handler spans to improve tracing. `effect/packages/effect/src/Effect.ts:14486`
- Model failures using `Schema.TaggedError`. `effect/packages/effect/src/Schema.ts:8813`

## Error Model
Define module errors as structured errors:
- `LanguageReviewError` (tagged) for domain failures.
- Wrap provider errors into `LanguageReviewError` at the boundary.

References: `effect/packages/effect/src/Schema.ts:8813`

## MVP Implementation Guidance
1. Build the prompt from config + input (include rubric and optional examples).
2. Call `LanguageModel.generateObject` with:
   - `prompt` (string)
   - `schema` (LanguageReviewOutput)
   - `objectName` (e.g. "languageReview")
3. Return `LanguageReviewOutput`.
4. Map into `TurnEvaluation` when writing scores. `apps/shared/src/RoomProtocol.ts:4`

## Suggested Defaults (Config)
- `temperature`: 0.2 or 0.0 (deterministic) per research. `docs/llm_language_review_research.md:86`
- `model`: Gemini 3 class model (configurable), low temperature by default.
- `maxTokens`: keep low for predictable latency.
- `rubric`: static string versioned in code or D1.

## Testing
- For unit tests, provide a fake `LanguageModel` via `Layer.succeed`.
- For integration tests, use a stubbed `LanguageReview` layer.

References: `effect/packages/effect/src/Layer.ts:1`, `apps/api/src/http/__tests__/turns.test.ts:1`
