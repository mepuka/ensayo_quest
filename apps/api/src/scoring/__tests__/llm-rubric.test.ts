import { it, expect } from "bun:test";
import { parseRubricOutput } from "../LLMRubric";

it("rejects invalid rubric JSON", () => {
  const result = parseRubricOutput("{bad}");
  expect(result._tag).toBe("Left");
});
