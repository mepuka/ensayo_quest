import * as Schema from "effect/Schema";
import { RoleRubric } from "./RoleRubric";
import { TurnPlan } from "./TurnPlan";

export class ScenarioTemplate extends Schema.Class<ScenarioTemplate>("ScenarioTemplate")({
  templateId: Schema.String,
  topic: Schema.String,
  level: Schema.String,
  turnPlan: Schema.Array(TurnPlan),
  roleRubrics: Schema.Array(RoleRubric)
}) {}

export const decodeScenarioTemplate = Schema.decodeUnknownSync(ScenarioTemplate);
export const encodeScenarioTemplate = Schema.encodeSync(ScenarioTemplate);
