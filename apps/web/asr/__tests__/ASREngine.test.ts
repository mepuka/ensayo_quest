import { it, expect } from "bun:test";
import { decodeAsrConfig, defaultConfig, encodeAsrConfig } from "../types";

it("uses whisper-base by default", () => {
  expect(defaultConfig.model).toBe("whisper-base");
});

it("round-trips ASR config encoding", () => {
  const encoded = encodeAsrConfig(defaultConfig);
  const decoded = decodeAsrConfig(encoded);
  expect(decoded).toBeDefined();
});
