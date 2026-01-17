/**
 * Recording Operations - Atom.runtime.fn for model loading
 *
 * Placeholder for preload operations.
 * Implementation depends on ASR engine integration.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Operation atoms section
 */
import { Atom } from "@effect-atom/atom-react";
import { Effect } from "effect";
import { modelLoadingAtom } from "./recording";

// =============================================================================
// Model Preload Operation
// =============================================================================

/**
 * Preload ASR model operation.
 *
 * Updates modelLoadingAtom with progress states:
 * - checking_cache → downloading → initializing → ready
 *
 * Implementation will integrate with ASR engine.
 */
export const preloadModelFn = Atom.fn<void>()(
  Effect.fnUntraced(function* () {
    // TODO: Implement model preloading
    // 1. Check cache
    // 2. Download if needed (update progress)
    // 3. Initialize model
    // 4. Update modelLoadingAtom to ready
    yield* Effect.logInfo("Model preload requested - not yet implemented");
  })
);
