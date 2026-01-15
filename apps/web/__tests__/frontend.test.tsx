import { it, expect } from "bun:test";
import React from "react";
import { Frontend } from "../frontend";

it("renders the Frontend root section", () => {
  const element = React.createElement(Frontend);
  expect(element.type).toBe(Frontend);
});
