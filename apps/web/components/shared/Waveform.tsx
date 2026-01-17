/**
 * Waveform - Audio visualization component
 *
 * Uses speechProbabilityAtom for real-time visualization.
 * Renders animated bars based on speech probability.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Custom components
 */
import * as React from "react";
import { useAtomValue } from "@effect-atom/atom-react";
import { speechProbabilityAtom } from "../../atoms";
import { cn } from "../../lib/utils";

export interface WaveformProps {
  /**
   * Number of bars to display.
   * @default 5
   */
  barCount?: number;

  /**
   * Height of the waveform container in pixels.
   * @default 32
   */
  height?: number;

  /**
   * Whether the waveform is active (recording).
   * When false, shows minimal animation.
   */
  active?: boolean;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Audio waveform visualization that reacts to speech probability.
 *
 * Uses CSS animations with heights derived from speechProbabilityAtom.
 * Each bar has slightly different animation timing for organic feel.
 *
 * @example
 * ```tsx
 * <Waveform active={isRecording} />
 * ```
 */
export function Waveform({
  barCount = 5,
  height = 32,
  active = false,
  className
}: WaveformProps) {
  const probability = useAtomValue(speechProbabilityAtom);

  // Scale probability to height (0-1 → 20%-100% of height)
  const baseHeight = active ? 0.2 + probability * 0.8 : 0.15;

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1",
        className
      )}
      style={{ height }}
      role="img"
      aria-label={active ? "Recording audio" : "Microphone ready"}
    >
      {Array.from({ length: barCount }).map((_, i) => {
        // Vary height per bar for organic look
        const variance = Math.sin((i / barCount) * Math.PI) * 0.3;
        const barHeight = Math.min(1, Math.max(0.1, baseHeight + variance));

        return (
          <div
            key={i}
            className={cn(
              "w-1 rounded-full transition-all duration-150",
              active
                ? "bg-primary animate-pulse motion-reduce:animate-none"
                : "bg-muted-foreground/30"
            )}
            style={{
              height: `${barHeight * 100}%`,
              animationDelay: `${i * 100}ms`
            }}
          />
        );
      })}
    </div>
  );
}
