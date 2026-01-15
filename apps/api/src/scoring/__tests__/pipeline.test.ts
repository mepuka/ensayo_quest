import { it, expect } from "bun:test";
import { scoreRoleVocab } from "../Vocab";
import { combineScores } from "../Combine";
import { aggregateQuestScore } from "../Aggregate";

it("scores role vocab based on target matches", () => {
  const score = scoreRoleVocab("quiero pedir perdon", ["pedir", "perdonar"]);
  expect(score).toBeGreaterThan(0);
});

it("aggregates per-turn scores into a quest score", () => {
  const overall = combineScores({
    fluency: 80,
    vocab: 60,
    grammar: 70,
    relevance: 90,
    pronunciation: 50,
    naturalness: 70
  });
  const final = aggregateQuestScore([overall, overall]);
  expect(final).toBe(overall);
});
