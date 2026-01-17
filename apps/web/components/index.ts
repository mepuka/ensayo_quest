/**
 * Components Barrel Export
 *
 * Central export for all component modules.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Component Hierarchy
 */

// Main app component
export { App } from "./App";

// Mode components
export { RoomSetup } from "./RoomSetup";
export { GameSession } from "./GameSession";
export { GameComplete } from "./GameComplete";

// Shared components
export * from "./shared";

// UI components (shadcn)
export * from "./ui/button";
export * from "./ui/card";
export * from "./ui/badge";
export * from "./ui/progress";
export * from "./ui/alert";
