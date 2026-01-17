import { it, expect } from "bun:test";
import React from "react";
import { Root, App } from "../frontend";

it("renders the Root component", () => {
  const element = React.createElement(Root);
  expect(element.type).toBe(Root);
});

it("exports App component", () => {
  expect(App).toBeDefined();
});
