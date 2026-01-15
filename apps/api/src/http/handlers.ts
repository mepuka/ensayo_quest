import * as Either from "effect/Either";
import * as Schema from "effect/Schema";
import { TurnSubmission } from "../domain/TurnSubmission";

export type TurnJob = { roomId: string; turnId: string };

export type SubmitTurnDeps = {
  insertTurn: (submission: TurnSubmission) => Promise<void>;
  enqueueTurn: (job: TurnJob) => Promise<void>;
  verifyTurnstile?: (token: string) => Promise<boolean>;
};

export type CreateRoomDeps = {
  createRoom: (roomId: string) => Promise<void>;
  createRoomId?: () => string;
};

export const validateTurnSubmission = (input: unknown) =>
  Either.try({
    try: () => Schema.decodeUnknownSync(TurnSubmission)(input),
    catch: (error) => error
  });

export const createRoom = async (deps: CreateRoomDeps) => {
  const createId = deps.createRoomId ?? (() => crypto.randomUUID());
  const roomId = createId();
  await deps.createRoom(roomId);
  return { roomId };
};

export const submitTurn = async (
  deps: SubmitTurnDeps,
  input: unknown,
  options?: { turnstileToken?: string }
) => {
  const parsed = validateTurnSubmission(input);
  if (parsed._tag === "Left") {
    return parsed;
  }
  if (deps.verifyTurnstile && options?.turnstileToken) {
    const ok = await deps.verifyTurnstile(options.turnstileToken);
    if (!ok) {
      return Either.left(new Error("turnstile_failed"));
    }
  }
  await deps.insertTurn(parsed.right);
  await deps.enqueueTurn({ roomId: parsed.right.roomId, turnId: parsed.right.turnId });
  return Either.right({ turnId: parsed.right.turnId, status: "processing" as const });
};

export const streamRoom = async () => {
  return { status: "streaming" as const };
};

export const handlers = { validateTurnSubmission, createRoom, submitTurn, streamRoom };
