// apps/web/asr/worklet/audioProcessor.ts
class AudioProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const [input] = inputs;
    if (!input || input.length === 0) {
      return true;
    }
    const channel = input[0];
    if (channel) {
      this.port.postMessage(channel.slice());
    }
    return true;
  }
}
registerProcessor("audio-processor", AudioProcessor);
