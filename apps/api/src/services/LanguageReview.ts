import * as Prompt from "@effect/ai/Prompt";
import * as LanguageModel from "@effect/ai/LanguageModel";
import { Context, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";

export const LanguageReviewMode = Schema.Literal("spoken", "written");

export const LanguageReviewSubscores = Schema.Struct({
  fluency: Schema.Number,
  vocab: Schema.Number,
  grammar: Schema.Number,
  relevance: Schema.Number,
  pronunciation: Schema.Number,
  naturalness: Schema.Number
});

export const LanguageReviewFeedback = Schema.Struct({
  wins: Schema.Array(Schema.String),
  fixes: Schema.Array(Schema.String)
});

export const LanguageReviewCorrection = Schema.Struct({
  original: Schema.String,
  improved: Schema.String,
  why: Schema.String
});

export const LanguageReviewOutput = Schema.Struct({
  subscores: LanguageReviewSubscores,
  feedback: LanguageReviewFeedback,
  correctedPhrases: Schema.Array(LanguageReviewCorrection),
  nextPrompt: Schema.String,
  confidence: Schema.Number,
  modelVersion: Schema.String
});

export type LanguageReviewOutput = Schema.Schema.Type<typeof LanguageReviewOutput>;

export const LanguageReviewExample = Schema.Struct({
  transcript: Schema.String,
  subscores: LanguageReviewSubscores,
  rationale: Schema.String
});

export const LanguageReviewInput = Schema.Struct({
  mode: LanguageReviewMode,
  language: Schema.String,
  transcript: Schema.String,
  audioFeatures: Schema.optional(
    Schema.Struct({
      durationMs: Schema.Number,
      pauseCount: Schema.Number,
      speakingRateWpm: Schema.Number
    })
  ),
  targetVocab: Schema.optional(Schema.Array(Schema.String)),
  targetGrammar: Schema.optional(Schema.Array(Schema.String)),
  objectives: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        description: Schema.String
      })
    )
  ),
  rubric: Schema.optional(Schema.String),
  examples: Schema.optional(Schema.Array(LanguageReviewExample))
});

export type LanguageReviewInput = Schema.Schema.Type<typeof LanguageReviewInput>;

export class LanguageReviewError extends Schema.TaggedError<LanguageReviewError>()(
  "LanguageReviewError",
  { reason: Schema.String }
) {}

export type LanguageReviewConfigValue = {
  model: string;
  temperature: number;
  maxTokens: number;
  rubric: string;
  systemPrompt: string;
  includeExamples: boolean;
  maxExamples: number;
  promptVersion: string;
};

export class LanguageReviewConfig extends Context.Tag("LanguageReviewConfig")<
  LanguageReviewConfig,
  LanguageReviewConfigValue
>() {}

const defaultRubric = [
  "Score the transcript for fluency, vocabulary, grammar, relevance,",
  "pronunciation, and naturalness on a 0-100 scale.",
  "Provide short wins and fixes, corrected phrases, and a next prompt.",
  "Use only evidence from the transcript and provided context."
].join(" ");

const defaultSystemPrompt = [
  "You are a language assessment engine for learners.",
  "Follow the rubric and return only JSON matching the schema.",
  "Do not include reasoning or markdown."
].join(" ");

export const defaultLanguageReviewConfig: LanguageReviewConfigValue = {
  model: "gemini-3",
  temperature: 0.2,
  maxTokens: 800,
  rubric: defaultRubric,
  systemPrompt: defaultSystemPrompt,
  includeExamples: false,
  maxExamples: 2,
  promptVersion: "v1"
};

export const LanguageReviewConfigLive = Layer.succeed(
  LanguageReviewConfig,
  defaultLanguageReviewConfig
);

const buildExamplesSection = (
  examples: ReadonlyArray<Schema.Schema.Type<typeof LanguageReviewExample>>,
  maxExamples: number
) => {
  if (examples.length === 0) {
    return "";
  }
  const limited = examples.slice(0, Math.max(0, maxExamples));
  const rendered = limited.map((example, index) => {
    return [
      `Example ${index + 1}:`,
      `Transcript: ${example.transcript}`,
      `Subscores: ${JSON.stringify(example.subscores)}`,
      `Rationale: ${example.rationale}`
    ].join("\n");
  });
  return rendered.join("\n\n");
};

const buildUserPrompt = (input: LanguageReviewInput, config: LanguageReviewConfigValue) => {
  const sections: Array<string> = [];
  sections.push(`Prompt version: ${config.promptVersion}`);
  sections.push(`Mode: ${input.mode}`);
  sections.push(`Language: ${input.language}`);
  const rubric = input.rubric ?? config.rubric;
  if (rubric.trim().length > 0) {
    sections.push(`Rubric:\n${rubric}`);
  }
  if (input.targetVocab && input.targetVocab.length > 0) {
    sections.push(`Target vocab: ${input.targetVocab.join(", ")}`);
  }
  if (input.targetGrammar && input.targetGrammar.length > 0) {
    sections.push(`Target grammar: ${input.targetGrammar.join(", ")}`);
  }
  if (input.objectives && input.objectives.length > 0) {
    const objectiveLines = input.objectives.map(
      (objective) => `- ${objective.id}: ${objective.description}`
    );
    sections.push(`Objectives:\n${objectiveLines.join("\n")}`);
  }
  if (input.audioFeatures) {
    sections.push(`Audio features:\n${JSON.stringify(input.audioFeatures)}`);
  }
  if (config.includeExamples && input.examples && input.examples.length > 0) {
    const examplesSection = buildExamplesSection(input.examples, config.maxExamples);
    if (examplesSection.trim().length > 0) {
      sections.push(`Examples:\n${examplesSection}`);
    }
  }
  sections.push(`Transcript:\n${input.transcript}`);
  sections.push(
    "Return JSON with keys: subscores, feedback, correctedPhrases, nextPrompt, confidence, modelVersion."
  );
  sections.push("Use integer scores 0-100 and confidence 0-1.");
  return sections.join("\n\n");
};

export const buildLanguageReviewPrompt = (
  input: LanguageReviewInput,
  config: LanguageReviewConfigValue
) =>
  Prompt.make([
    { role: "system", content: config.systemPrompt },
    {
      role: "user",
      content: [{ type: "text", text: buildUserPrompt(input, config) }]
    }
  ]);

export interface LanguageReviewService {
  review: (input: LanguageReviewInput) => Effect.Effect<LanguageReviewOutput, LanguageReviewError, never>;
}

export class LanguageReview extends Context.Tag("LanguageReview")<
  LanguageReview,
  LanguageReviewService
>() {}

export const LanguageReviewLive = Layer.effect(
  LanguageReview,
  Effect.gen(function* () {
    const config = yield* LanguageReviewConfig;
    const model = yield* LanguageModel.LanguageModel;
    const review = Effect.fn("LanguageReview.review")(function* (
      input: LanguageReviewInput
    ) {
      const prompt = buildLanguageReviewPrompt(input, config);
      const response = yield* model.generateObject({
        prompt,
        schema: LanguageReviewOutput,
        objectName: "languageReview",
        toolChoice: "none"
      });
      return {
        ...response.value,
        modelVersion: config.model
      };
    });
    return {
      review: (input) =>
        review(input).pipe(
          Effect.mapError((cause) => new LanguageReviewError({ reason: String(cause) }))
        )
    };
  })
);
