import { it, expect } from "bun:test";
import React from "react";
import { Frontend } from "../frontend";

it("renders the Frontend root section", () => {
  const element = Frontend();
  expect(element.type).toBe("main");
});
