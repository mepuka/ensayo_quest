import { describe, expect, it } from "bun:test";
import { initialAsrState, reduceAsrState } from "../AsrAtoms";

describe("reduceAsrState", () => {
  it("transitions to recording on start", () => {
    const next = reduceAsrState(initialAsrState, { type: "start" });
    expect(next.status).toBe("recording");
    expect(next.transcript).toBe("");
    expect(next.error).toBeNull();
  });

  it("stores transcript on stop", () => {
    const next = reduceAsrState(initialAsrState, {
      type: "stop",
      transcript: "hola mundo"
    });
    expect(next.status).toBe("stopped");
    expect(next.transcript).toBe("hola mundo");
    expect(next.error).toBeNull();
  });

  it("records errors", () => {
    const next = reduceAsrState(initialAsrState, {
      type: "error",
      message: "mic failed"
    });
    expect(next.status).toBe("error");
    expect(next.error).toBe("mic failed");
  });
});
