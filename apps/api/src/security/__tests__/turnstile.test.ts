import { it, expect } from "bun:test";
import { verifyToken } from "../Turnstile";

it("rejects empty Turnstile token", async () => {
  const ok = await verifyToken("");
  expect(ok).toBe(false);
});
