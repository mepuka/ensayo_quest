/**
 * ErrorMessage - Consistent error display component
 *
 * Uses shadcn Alert with destructive variant.
 * Supports retry action for recoverable errors.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Shared components
 */
import * as React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

export interface ErrorMessageProps {
  /**
   * Error title (optional).
   * Defaults to "Error".
   */
  title?: string;

  /**
   * Error message to display.
   */
  message: string;

  /**
   * Whether the error is retryable.
   * Shows retry button when true.
   */
  retryable?: boolean;

  /**
   * Callback when retry button is clicked.
   */
  onRetry?: () => void;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Consistent error display with optional retry action.
 *
 * @example
 * ```tsx
 * <ErrorMessage
 *   title="Connection Failed"
 *   message="Unable to connect to server"
 *   retryable
 *   onRetry={() => reconnect()}
 * />
 * ```
 */
export function ErrorMessage({
  title = "Error",
  message,
  retryable = false,
  onRetry,
  className
}: ErrorMessageProps) {
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>{message}</span>
        {retryable && onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="shrink-0"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

// =============================================================================
// Result Error Display
// =============================================================================

export interface ResultErrorProps {
  /**
   * Error from Result.error().
   * Can be Error, string, or unknown.
   */
  error: unknown;

  /**
   * Error title (optional).
   */
  title?: string;

  /**
   * Retry callback.
   */
  onRetry?: () => void;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Display error from an Effect Result.
 *
 * @example
 * ```tsx
 * const result = useAtomValue(createRoomFn);
 *
 * {Result.isFailure(result) && (
 *   <ResultError
 *     error={Result.error(result)}
 *     onRetry={() => trigger(input)}
 *   />
 * )}
 * ```
 */
export function ResultError({ error, title, onRetry, className }: ResultErrorProps) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "An unexpected error occurred";

  return (
    <ErrorMessage
      message={message}
      retryable={!!onRetry}
      {...(title !== undefined && { title })}
      {...(onRetry !== undefined && { onRetry })}
      {...(className !== undefined && { className })}
    />
  );
}
