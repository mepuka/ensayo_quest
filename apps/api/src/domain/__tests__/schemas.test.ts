import { it, expect } from "bun:test";
import * as Schema from "effect/Schema";
import { TurnSubmission } from "../TurnSubmission";
import { ScenarioTemplate } from "../ScenarioTemplate";
import { TurnPlan } from "../TurnPlan";
import { RoleRubric } from "../RoleRubric";
import { QueueJob } from "../QueueJob";

it("validates TurnSubmission shape", () => {
  const input = {
    roomId: "r",
    turnId: "t",
    templateId: "tmp",
    turnIndex: 0,
    speakerUserId: "u",
    transcript: "hola",
    audioStats: { totalMs: 1000, speechMs: 800, silenceMs: 200, segments: [] }
  };
  const result = Schema.decodeUnknownSync(TurnSubmission)(input);
  expect(result).toBeDefined();
});

it("validates turn-scripted scenario templates", () => {
  const template = {
    templateId: "tpl-1",
    topic: "restaurant",
    level: "A2",
    seedPrompt: "Bienvenido",
    turnPlan: [
      { turnIndex: 0, speakerRole: "A", promptType: "user", objectiveIds: ["o1"] }
    ],
    roleRubrics: [
      { roleId: "A", targetVocab: ["pedir"], targetGrammar: ["polite_request"] }
    ]
  };
  const result = Schema.decodeUnknownSync(ScenarioTemplate)(template);
  expect(result).toBeInstanceOf(ScenarioTemplate);
});

it("validates TurnPlan and RoleRubric classes", () => {
  const plan = Schema.decodeUnknownSync(TurnPlan)({
    turnIndex: 0,
    speakerRole: "A",
    promptType: "user",
    objectiveIds: ["o1", "o2"]
  });
  const rubric = Schema.decodeUnknownSync(RoleRubric)({
    roleId: "A",
    targetVocab: ["perdonar"],
    targetGrammar: ["past_tense"]
  });
  expect(plan).toBeInstanceOf(TurnPlan);
  expect(rubric).toBeInstanceOf(RoleRubric);
});

it("validates turn scoring queue job payloads", () => {
  const job = Schema.decodeUnknownSync(QueueJob)({
    roomId: "r1",
    turnId: "t1",
    status: "final"
  });
  expect(job).toBeInstanceOf(QueueJob);
  expect(job.status).toBe("final");

  const readyJob = Schema.decodeUnknownSync(QueueJob)({
    roomId: "r2",
    turnId: "t2",
    status: "ready"
  });
  expect(readyJob.status).toBe("ready");
});
