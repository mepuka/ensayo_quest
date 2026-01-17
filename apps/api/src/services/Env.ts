import { Context } from "effect";

export interface CloudflareEnv {
  DB: D1Database;
  AUDIO_BUCKET: R2Bucket;
  SPANISH_VECTORS: VectorizeIndex;
  TURN_QUEUE: Queue;
  ROOMS: DurableObjectNamespace;
  // Note: Workers AI binding removed - project uses Google Gemini API (LanguageReviewGoogle)
  // If Workers AI is needed, add wrangler config: [[ai]] binding = "AI"
  GOOGLE_AI_API_KEY?: string;
  GOOGLE_AI_API_URL?: string;
  // Language review mode: "google" | "mock" | "disabled" (default: "google")
  // Use "mock" for integration tests, "disabled" to skip LLM scoring
  LANGUAGE_REVIEW_MODE?: string;
}

export class Env extends Context.Tag("Env")<Env, CloudflareEnv>() {}
