/**
 * RecordingPanel - Mic button, phase indicator, waveform
 *
 * Controls for voice recording with visual feedback.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - GameSession section
 */
import { useRecording } from "../../hooks";
import { RecordingButton } from "../shared/RecordingButton";
import { Waveform } from "../shared/Waveform";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import { cn } from "../../lib/utils";

export interface RecordingPanelProps {
  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Recording controls panel with mic button and feedback.
 */
export function RecordingPanel({ className }: RecordingPanelProps) {
  const {
    appReady,
    phase,
    canRecord,
    start,
    stop,
    speechProbability,
    metrics
  } = useRecording();

  const isListening = phase === "listening";
  const isProcessing = phase === "processing";

  // Calculate progress for max recording duration (30 seconds)
  const maxDurationMs = 30000;
  const durationProgress = Math.min((metrics.durationMs / maxDurationMs) * 100, 100);

  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      {/* App Ready Status */}
      {appReady !== "ready" && (
        <Badge variant="secondary">
          {appReady === "idle" && "No room selected"}
          {appReady === "loading_model" && "Loading model..."}
          {appReady === "connecting" && "Connecting..."}
          {appReady === "syncing" && "Syncing..."}
          {appReady === "error" && "Error"}
        </Badge>
      )}

      {/* Waveform / Visual Feedback */}
      <div className="h-16 w-full max-w-xs">
        <Waveform active={isListening} />
      </div>

      {/* Recording Button */}
      <RecordingButton
        phase={phase}
        probability={speechProbability}
        onClick={isListening ? stop : start}
        disabled={!canRecord}
      />

      {/* Duration Progress (when recording) */}
      {isListening && (
        <div className="w-full max-w-xs space-y-1">
          <Progress
            value={durationProgress}
            aria-label={`Recording duration: ${Math.floor(metrics.durationMs / 1000)} of 30 seconds`}
          />
          <p className="text-xs text-center text-muted-foreground" aria-hidden="true">
            {Math.floor(metrics.durationMs / 1000)}s / 30s
          </p>
        </div>
      )}

      {/* Processing Indicator */}
      {isProcessing && (
        <Badge variant="outline">Processing speech...</Badge>
      )}

      {/* Phase Label */}
      <p className="text-xs text-muted-foreground capitalize">
        {phase}
      </p>
    </div>
  );
}
