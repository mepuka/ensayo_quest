import { it, expect } from "bun:test";
import { decodeEventLogRequest, encodeEventLogRequest } from "../eventlogCodec";
import { Ping } from "@effect/experimental/EventLogRemote";

it("encodes and decodes EventLogRemote requests", () => {
  const encoded = encodeEventLogRequest(new Ping({ id: 1 }));
  const decoded = decodeEventLogRequest(encoded);
  expect(decoded._tag).toBe("Ping");
});
