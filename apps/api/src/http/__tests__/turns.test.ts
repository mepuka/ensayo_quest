import { it, expect } from "bun:test";
import { createRoom, submitTurn, validateTurnSubmission } from "../handlers";

it("rejects invalid TurnSubmission", () => {
  const result = validateTurnSubmission({});
  expect(result._tag).toBe("Left");
});

it("createRoom creates a room id", async () => {
  let createdId = "";
  const result = await createRoom({
    createRoomId: () => "room-1",
    createRoom: async (roomId) => {
      createdId = roomId;
    }
  });
  expect(result.roomId).toBe("room-1");
  if (createdId.length === 0) {
    throw new Error("room id was not created");
  }
  expect(createdId).toBe("room-1");
});

it("submitTurn enqueues a job for valid input", async () => {
  let enqueued: Array<{ roomId: string; turnId: string }> = [];
  let inserted: Array<string> = [];
  const input = {
    roomId: "r",
    turnId: "t",
    templateId: "tmp",
    turnIndex: 0,
    speakerUserId: "u",
    transcript: "hola",
    audioStats: { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] }
  };
  const result = await submitTurn(
    {
      insertTurn: async (submission) => {
        inserted.push(submission.turnId);
      },
      enqueueTurn: async (job) => {
        enqueued.push(job);
      }
    },
    input
  );
  expect(result._tag).toBe("Right");
  if (result._tag === "Right") {
    expect(result.right.turnId).toBe("t");
    expect(result.right.status).toBe("processing");
  }
  expect(inserted).toEqual(["t"]);
  expect(enqueued).toEqual([{ roomId: "r", turnId: "t" }]);
});

it("submitTurn rejects when Turnstile check fails", async () => {
  let enqueued: Array<{ roomId: string; turnId: string }> = [];
  let inserted: Array<string> = [];
  const input = {
    roomId: "r",
    turnId: "t",
    templateId: "tmp",
    turnIndex: 0,
    speakerUserId: "u",
    transcript: "hola",
    audioStats: { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] }
  };
  const result = await submitTurn(
    {
      insertTurn: async (submission) => {
        inserted.push(submission.turnId);
      },
      enqueueTurn: async (job) => {
        enqueued.push(job);
      },
      verifyTurnstile: async () => false
    },
    input,
    { turnstileToken: "invalid" }
  );
  expect(result._tag).toBe("Left");
  expect(inserted).toEqual([]);
  expect(enqueued).toEqual([]);
});
