import { describe, expect, it } from "bun:test";
import { appendAudioBuffer } from "../audioBuffer";

describe("appendAudioBuffer", () => {
  it("appends samples to existing buffer", () => {
    const current = new Float32Array([0.1, 0.2]);
    const next = new Float32Array([0.3, 0.4, 0.5]);
    const result = appendAudioBuffer(current, next);

    const values = Array.from(result);
    expect(values.length).toBe(5);
    expect(values[0]).toBeCloseTo(0.1, 6);
    expect(values[1]).toBeCloseTo(0.2, 6);
    expect(values[2]).toBeCloseTo(0.3, 6);
    expect(values[3]).toBeCloseTo(0.4, 6);
    expect(values[4]).toBeCloseTo(0.5, 6);
  });
});
