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
      this.port.postMessage(channel);
    }
    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
