import { it, expect } from "bun:test";
import { Effect } from "effect";
import { uploadTurnAudio } from "../handlers";
import { Db, DbError } from "../../services/Db";
import { AudioBucket } from "../../services/CloudflareLayers";

it("stores audio and updates audio key", async () => {
  let storedKey = "";
  let updatedKey = "";
  const audio = new Uint8Array([1, 2, 3]).buffer;
  const result = await Effect.runPromise(
    uploadTurnAudio({
      turnId: "t1",
      audio,
      contentType: "audio/webm"
    }).pipe(
      Effect.provideService(AudioBucket, {
        put: (key, _value, _options) => {
          storedKey = key;
          return Promise.resolve({} as R2Object);
        }
      } as R2Bucket),
      Effect.provideService(Db, {
        createRoom: () => Effect.void as any,
        findScenarioTemplate: () =>
          Effect.succeed({
            templateId: "tmp",
            topic: "travel",
            level: "A1",
            seedPrompt: "Hola",
            turnPlan: [],
            roleRubrics: []
          }),
        insertTurn: () => Effect.void,
        getRoomTemplateId: () => Effect.succeed("tmp"),
        getNextTurnIndex: () => Effect.succeed(0),
        getTurnSubmission: () =>
          Effect.succeed({
            roomId: "r",
            turnId: "t1",
            templateId: "tmp",
            turnIndex: 0,
            speakerUserId: "u",
            transcript: "hola",
            audioStats: { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] }
          }),
        getScenarioTemplate: () =>
          Effect.succeed({
            templateId: "tmp",
            topic: "travel",
            level: "A1",
            seedPrompt: "Hola",
            turnPlan: [],
            roleRubrics: []
          }),
        updateTurnAudioKey: (input) =>
          Effect.sync(() => {
            updatedKey = input.audioKey;
          }),
        updateTurnScore: () => Effect.void
      })
    )
  );
  expect(result.audioKey).toBe("turns/t1");
  expect(storedKey).toBe("turns/t1");
  expect(updatedKey).toBe("turns/t1");
});

it("rejects audio upload for missing turns", async () => {
  let storedKey = "";
  const audio = new Uint8Array([1, 2, 3]).buffer;
  const result = await Effect.runPromise(
    Effect.either(
      uploadTurnAudio({
        turnId: "missing",
        audio,
        contentType: "audio/webm"
      }).pipe(
        Effect.provideService(AudioBucket, {
          put: (key, _value, _options) => {
            storedKey = key;
            return Promise.resolve({} as R2Object);
          }
        } as R2Bucket),
        Effect.provideService(Db, {
          createRoom: () => Effect.void as any,
          findScenarioTemplate: () =>
            Effect.succeed({
              templateId: "tmp",
              topic: "travel",
              level: "A1",
              seedPrompt: "Hola",
              turnPlan: [],
              roleRubrics: []
            }),
          insertTurn: () => Effect.void,
          getRoomTemplateId: () => Effect.succeed("tmp"),
          getNextTurnIndex: () => Effect.succeed(0),
          getTurnSubmission: () => Effect.fail(new DbError({ reason: "turn_not_found" })),
          getScenarioTemplate: () =>
            Effect.succeed({
              templateId: "tmp",
              topic: "travel",
              level: "A1",
              seedPrompt: "Hola",
              turnPlan: [],
              roleRubrics: []
            }),
          updateTurnAudioKey: () => Effect.void,
          updateTurnScore: () => Effect.void
        })
      )
    )
  );
  expect(result._tag).toBe("Left");
  expect(storedKey).toBe("");
});
