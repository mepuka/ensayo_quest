import { Context, Effect, Queue, Ref, Stream, Layer } from "effect";
import { WorkletInitFailed } from "../errors";

export const workletName = "audio-processor";

export const buildWorkletUrl = (baseUrl: string) =>
  new URL("/audioProcessor.js", baseUrl).toString();

export type WorkletChunk = {
  samples: Float32Array;
  sampleRate: number;
};

export interface WorkletCaptureService {
  start: () => Effect.Effect<void, WorkletInitFailed, never>;
  stop: () => Effect.Effect<void, WorkletInitFailed, never>;
  stream: Stream.Stream<WorkletChunk, never, never>;
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

// Audio queue capacity: At 16kHz with ~128 samples/chunk, we get ~125 chunks/sec
// 200 chunks = ~1.6 seconds buffer - enough for ASR latency without unbounded growth
const AUDIO_QUEUE_CAPACITY = 200;

const makeCapture = Effect.gen(function* () {
  // Use sliding queue - drops oldest audio when full (better than backpressure for real-time audio)
  const queue = yield* Queue.sliding<WorkletChunk>(AUDIO_QUEUE_CAPACITY);
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
      const context = new AudioContext({ sampleRate: 16000 });
      yield* Effect.tryPromise({
        try: () => context.audioWorklet.addModule(buildWorkletUrl(window.location.href)),
        catch: (cause) => new WorkletInitFailed({ reason: String(cause) })
      });
      const source = context.createMediaStreamSource(media);
      const node = new AudioWorkletNode(context, workletName);
      node.port.onmessage = (event: MessageEvent) => {
        if (event.data instanceof Float32Array) {
          Queue.unsafeOffer(queue, { samples: event.data, sampleRate: context.sampleRate });
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
