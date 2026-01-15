import { Context, Effect, Queue, Ref, Stream, Layer } from "effect";
import { WorkletInitFailed } from "../errors";

export const workletName = "audio-processor";

export interface WorkletCaptureService {
  start: () => Effect.Effect<void, WorkletInitFailed, never>;
  stop: () => Effect.Effect<void, WorkletInitFailed, never>;
  stream: Stream.Stream<Float32Array, never, never>;
}

export class WorkletCapture extends Context.Tag("WorkletCapture")<
  WorkletCapture,
  WorkletCaptureService
>() {}

type CaptureState = {
  context: AudioContext;
  stream: MediaStream;
  node: AudioWorkletNode;
};

const makeCapture = Effect.gen(function* () {
  const queue = yield* Queue.unbounded<Float32Array>();
  const state = yield* Ref.make<CaptureState | null>(null);

  const start = Effect.fn(function* () {
      const existing = yield* Ref.get(state);
      if (existing) {
        return;
      }
      const media = yield* Effect.tryPromise({
        try: () => navigator.mediaDevices.getUserMedia({ audio: true }),
        catch: (cause) => new WorkletInitFailed({ reason: String(cause) })
      });
      const context = new AudioContext();
      yield* Effect.tryPromise({
        try: () => context.audioWorklet.addModule(new URL("./audioProcessor.ts", import.meta.url)),
        catch: (cause) => new WorkletInitFailed({ reason: String(cause) })
      });
      const source = context.createMediaStreamSource(media);
      const node = new AudioWorkletNode(context, workletName);
      node.port.onmessage = (event: MessageEvent) => {
        if (event.data instanceof Float32Array) {
          Queue.unsafeOffer(queue, event.data);
        }
      };
      source.connect(node);
      yield* Ref.set(state, { context, stream: media, node });
    });

  const stop = Effect.fn(function* () {
      const existing = yield* Ref.get(state);
      if (!existing) {
        return;
      }
      existing.node.disconnect();
      existing.stream.getTracks().forEach((track) => track.stop());
      yield* Effect.tryPromise({
        try: () => existing.context.close(),
        catch: (cause) => new WorkletInitFailed({ reason: String(cause) })
      });
      yield* Ref.set(state, null);
    });

  const stream = Stream.fromQueue(queue);

  return { start, stop, stream };
});

export const WorkletCaptureLive = Layer.effect(WorkletCapture, makeCapture);
