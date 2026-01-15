import { it, expect } from "bun:test";
import { InvalidTurnSubmission } from "../handlers";
import { toHttpError } from "../errorResponse";

it("returns a structured error response for invalid submissions", () => {
  const { status, body } = toHttpError(
    new InvalidTurnSubmission({ reason: "invalid_turn_submission" })
  );
  expect(status).toBe(400);
  expect(body.code).toBe("invalid_turn_submission");
});
