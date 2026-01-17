/**
 * RecordingButton - Mic button with phase-aware animation
 *
 * Shows visual feedback based on recording phase.
 * Integrates with speechProbabilityAtom for real-time animation.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Custom components
 */
import * as React from "react";
import { Match } from "effect";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import type { RecordingPhase } from "../../atoms";
import { cn } from "../../lib/utils";

export interface RecordingButtonProps {
  /**
   * Current recording phase.
   */
  phase: RecordingPhase;

  /**
   * Speech probability (0-1) for animation intensity.
   */
  probability?: number;

  /**
   * Click handler.
   */
  onClick?: () => void;

  /**
   * Whether the button is disabled.
   */
  disabled?: boolean;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Microphone button with phase-aware visual feedback.
 *
 * Visual states:
 * - ready: Solid mic icon, can record
 * - listening: Pulsing animation scaled by speech probability
 * - processing: Spinner animation
 * - not_ready: Dimmed, loading model
 * - no_permission: Mic-off icon
 * - error: Red mic-off icon
 *
 * @example
 * ```tsx
 * const phase = useAtomValue(recordingPhaseAtom);
 * const probability = useAtomValue(speechProbabilityAtom);
 *
 * <RecordingButton
 *   phase={phase}
 *   probability={probability}
 *   onClick={handleMicClick}
 * />
 * ```
 */
export function RecordingButton({
  phase,
  probability = 0,
  onClick,
  disabled,
  className
}: RecordingButtonProps) {
  const config = Match.value(phase).pipe(
    Match.when("ready", () => ({
      icon: Mic,
      variant: "default" as const,
      pulse: false,
      spin: false,
      enabled: true
    })),
    Match.when("listening", () => ({
      icon: Mic,
      variant: "default" as const,
      pulse: true,
      spin: false,
      enabled: true
    })),
    Match.when("processing", () => ({
      icon: Loader2,
      variant: "secondary" as const,
      pulse: false,
      spin: true,
      enabled: false
    })),
    Match.when("result", () => ({
      icon: Mic,
      variant: "default" as const,
      pulse: false,
      spin: false,
      enabled: true
    })),
    Match.when("not_ready", () => ({
      icon: Loader2,
      variant: "secondary" as const,
      pulse: false,
      spin: true,
      enabled: false
    })),
    Match.when("no_permission", () => ({
      icon: MicOff,
      variant: "destructive" as const,
      pulse: false,
      spin: false,
      enabled: false
    })),
    Match.when("error", () => ({
      icon: MicOff,
      variant: "destructive" as const,
      pulse: false,
      spin: false,
      enabled: false
    })),
    Match.exhaustive
  );

  const Icon = config.icon;

  // Scale pulse animation intensity by probability
  const pulseScale = config.pulse ? 1 + probability * 0.3 : 1;

  return (
    <Button
      variant={config.variant}
      size="icon-lg"
      onClick={onClick}
      disabled={disabled || !config.enabled}
      className={cn(
        "relative rounded-full transition-transform",
        config.pulse && "animate-pulse motion-reduce:animate-none",
        className
      )}
      style={{
        transform: config.pulse ? `scale(${pulseScale})` : undefined
      }}
      aria-label={
        phase === "listening"
          ? "Recording... click to stop"
          : phase === "no_permission"
            ? "Microphone access denied"
            : "Click to start recording"
      }
    >
      <Icon className={cn("h-6 w-6", config.spin && "animate-spin motion-reduce:animate-none")} />

      {/* Pulse ring when listening */}
      {config.pulse && (
        <span
          className="absolute inset-0 rounded-full bg-primary/20 animate-ping motion-reduce:animate-none"
          style={{
            animationDuration: `${1.5 - probability}s`
          }}
        />
      )}
    </Button>
  );
}
