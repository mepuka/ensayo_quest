/**
 * AsyncButton - Button with loading state from Effect Result
 *
 * Uses Result.isWaiting() for loading detection.
 * Wraps shadcn Button with automatic disabled state during loading.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Shared components
 */
import * as React from "react";
import { Result } from "@effect-atom/atom-react";
import { Button, type buttonVariants } from "../ui/button";
import type { VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

export interface AsyncButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  /**
   * Result from an Atom.fn operation.
   * Button shows loading spinner when Result.isWaiting(result) is true.
   */
  result?: Result.Result<unknown, unknown>;

  /**
   * Loading text to show (optional).
   * If not provided, shows spinner only.
   */
  loadingText?: string;

  /**
   * Use Slot for composition.
   */
  asChild?: boolean;
}

/**
 * Button that shows loading state based on Effect Result.
 *
 * @example
 * ```tsx
 * const result = useAtomValue(createRoomFn);
 * const trigger = useAtomSet(createRoomFn);
 *
 * <AsyncButton
 *   result={result}
 *   onClick={() => trigger({ topic, level })}
 * >
 *   Create Room
 * </AsyncButton>
 * ```
 */
export function AsyncButton({
  result,
  loadingText,
  children,
  disabled,
  ...props
}: AsyncButtonProps) {
  const isLoading = result ? Result.isWaiting(result) : false;

  return (
    <Button disabled={disabled || isLoading} {...props}>
      {isLoading ? (
        <>
          <Loader2 className="animate-spin" />
          {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
