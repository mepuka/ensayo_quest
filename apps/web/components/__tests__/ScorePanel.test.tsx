import { it, expect } from "bun:test";
import React from "react";
import { ScorePanel } from "../ScorePanel";

it("renders a score panel with overall score", () => {
  const element = ScorePanel({
    turnId: "t1",
    status: "partial",
    overall: 78
  });
  expect(element.type).toBe("section");
  expect(element.props["data-status"]).toBe("partial");
});
