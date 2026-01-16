import * as GoogleClient from "@effect/ai-google/GoogleClient";
import * as GoogleLanguageModel from "@effect/ai-google/GoogleLanguageModel";
import * as LanguageModel from "@effect/ai/LanguageModel";
import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import { Context, Effect, Layer } from "effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Env } from "./Env";
import {
  LanguageReviewConfig,
  LanguageReviewConfigLive,
  LanguageReviewLive
} from "./LanguageReview";

export class GoogleAiConfigError extends Schema.TaggedError<GoogleAiConfigError>()(
  "GoogleAiConfigError",
  { reason: Schema.String }
) {}

export type GoogleAiConfigValue = {
  apiKey: Redacted.Redacted;
  apiUrl?: string;
};

export class GoogleAiConfig extends Context.Tag("GoogleAiConfig")<
  GoogleAiConfig,
  GoogleAiConfigValue
>() {}

export const GoogleAiConfigLive = Layer.effect(
  GoogleAiConfig,
  Effect.gen(function* () {
    const env = yield* Env;
    const rawKey = env.GOOGLE_AI_API_KEY?.trim();
    if (!rawKey) {
      return yield* new GoogleAiConfigError({ reason: "missing_google_ai_api_key" });
    }
    const apiUrl = env.GOOGLE_AI_API_URL?.trim();
    return {
      apiKey: Redacted.make(rawKey),
      ...(apiUrl ? { apiUrl } : {})
    };
  })
);

export const GoogleClientLive = Layer.scoped(
  GoogleClient.GoogleClient,
  Effect.gen(function* () {
    const config = yield* GoogleAiConfig;
    return yield* GoogleClient.make({
      apiKey: config.apiKey,
      ...(config.apiUrl ? { apiUrl: config.apiUrl } : {})
    });
  })
).pipe(
  Layer.provideMerge(GoogleAiConfigLive),
  Layer.provideMerge(FetchHttpClient.layer)
);

export const GoogleLanguageModelLive = Layer.effect(
  LanguageModel.LanguageModel,
  Effect.gen(function* () {
    const config = yield* LanguageReviewConfig;
    return yield* GoogleLanguageModel.make({
      model: config.model,
      config: {
        generationConfig: {
          temperature: config.temperature,
          maxOutputTokens: config.maxTokens
        },
        toolConfig: {}
      }
    });
  })
).pipe(
  Layer.provideMerge(GoogleClientLive),
  Layer.provideMerge(LanguageReviewConfigLive)
);

export const LanguageReviewGoogleLive = LanguageReviewLive.pipe(
  Layer.provideMerge(GoogleLanguageModelLive),
  Layer.provideMerge(LanguageReviewConfigLive)
);
