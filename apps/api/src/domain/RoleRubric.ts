import * as Schema from "effect/Schema";

export class RoleRubric extends Schema.Class<RoleRubric>("RoleRubric")({
  roleId: Schema.String,
  targetVocab: Schema.Array(Schema.String),
  targetGrammar: Schema.Array(Schema.String)
}) {}
