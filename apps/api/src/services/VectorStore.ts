import { Context, Effect } from "effect";

export type VectorChunk = {
  id: string;
  text: string;
};

export interface VectorStoreService {
  query: (
    input: { topic: string; level: string }
  ) => Effect.Effect<Array<VectorChunk>, unknown, never>;
}

export class VectorStore extends Context.Tag("VectorStore")<VectorStore, VectorStoreService>() {}
