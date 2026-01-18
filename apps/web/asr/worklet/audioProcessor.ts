declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(inputs: Float32Array[][]): boolean;
}

declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor
): void;

class AudioProcessor extends AudioWorkletProcessor {
  override process(inputs: Float32Array[][]) {
    const [input] = inputs;
    if (!input || input.length === 0) {
      return true;
    }
    const channel = input[0];
    if (channel) {
      // Copy buffer before posting - AudioWorklet reuses the same buffer
      // @see docs/plans/2026-01-18-voice-stack-remediation.md - Phase 3
      // @see ensayo_quest-xzr: Phase 3 - Worklet buffer copy
      this.port.postMessage(channel.slice());
    }
    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
