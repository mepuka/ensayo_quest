/**
 * VoiceLab - Dev-only voice stack testing harness
 *
 * Provides panels for testing:
 * - Model preload progress
 * - VAD status and speech probability
 * - Transcription results and latency
 *
 * Access via: http://localhost:3000/?voiceLab=1 (dev mode only)
 *
 * @see docs/plans/2026-01-17-frontend-voice-stack-design.md - Voice Lab section
 * @see ensayo_quest-qnj: Phase 4 - Voice Lab
 */
import { useAtomValue, useAtomSet } from "@effect-atom/atom-react";
import { useState, useEffect } from "react";
import {
  modelLoadingAtom,
  vadSessionAtom,
  speechProbabilityAtom,
  asrResultAtom,
  micPermissionAtom,
  preloadModelFn,
  startRecordingFn,
  stopRecordingFn,
  type ModelLoadingState,
  type VadSessionState,
  type AsrResult,
  type MicPermission
} from "../../atoms";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";

interface TranscriptEntry {
  id: string;
  transcript: string;
  durationMs: number;
  timestamp: number;
}

/**
 * Voice Lab dev harness component.
 * Only render in development mode.
 */
export function VoiceLab() {
  // Atom values
  const modelState: ModelLoadingState = useAtomValue(modelLoadingAtom);
  const vadSession: VadSessionState = useAtomValue(vadSessionAtom);
  const speechProbability: number = useAtomValue(speechProbabilityAtom);
  const asrResult: AsrResult | null = useAtomValue(asrResultAtom);
  const micPermission: MicPermission = useAtomValue(micPermissionAtom);

  // Operations
  const preload = useAtomSet(preloadModelFn);
  const startRecording = useAtomSet(startRecordingFn);
  const stopRecording = useAtomSet(stopRecordingFn);
  const clearAsrResult = useAtomSet(asrResultAtom);

  // Local state for transcript log
  const [transcriptLog, setTranscriptLog] = useState<TranscriptEntry[]>([]);

  // Add transcript to log when ASR result changes
  // Uses functional setState to avoid transcriptLog dependency
  // @see docs/plans/2026-01-18-voice-stack-remediation.md - Phase 2
  // @see ensayo_quest-0en: Phase 2 - VoiceLab render fix
  useEffect(() => {
    if (!asrResult || !asrResult.transcript) return;
    setTranscriptLog((prev) => {
      // Skip if already logged (idempotent)
      if (prev[prev.length - 1]?.id === asrResult.requestId) {
        return prev;
      }
      return [
        ...prev,
        {
          id: asrResult.requestId,
          transcript: asrResult.transcript,
          durationMs: asrResult.durationMs,
          timestamp: Date.now()
        }
      ];
    });
  }, [asrResult]);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Voice Lab</h1>
          <Badge variant="outline">Dev Mode</Badge>
        </div>

        {/* Model Status Panel */}
        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-3">Model Status</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              <Badge
                variant={
                  modelState.status === "ready"
                    ? "default"
                    : modelState.status === "error"
                    ? "destructive"
                    : "secondary"
                }
              >
                {modelState.status}
              </Badge>
            </div>
            {modelState.downloadProgress !== undefined && (
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">Download Progress:</span>
                <Progress value={modelState.downloadProgress} />
              </div>
            )}
            {modelState.error && (
              <p className="text-sm text-destructive">{modelState.error}</p>
            )}
            <Button
              onClick={() => preload()}
              disabled={modelState.status === "downloading" || modelState.status === "initializing"}
              size="sm"
            >
              {modelState.status === "ready" ? "Re-Preload Model" : "Preload Model"}
            </Button>
          </div>
        </Card>

        {/* VAD Status Panel */}
        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-3">VAD Status</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Session:</span>
              <Badge
                variant={
                  vadSession.status === "running"
                    ? "default"
                    : vadSession.status === "error"
                    ? "destructive"
                    : "secondary"
                }
              >
                {vadSession.status}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Mic Permission:</span>
              <Badge variant={micPermission === "granted" ? "default" : "secondary"}>
                {micPermission}
              </Badge>
            </div>
            <div className="space-y-1">
              <span className="text-sm text-muted-foreground">
                Speech Probability: {(speechProbability * 100).toFixed(1)}%
              </span>
              <Progress value={speechProbability * 100} />
            </div>
            {vadSession.error && (
              <p className="text-sm text-destructive">{vadSession.error}</p>
            )}
            <div className="flex gap-2">
              <Button
                onClick={() => startRecording()}
                disabled={vadSession.status === "running" || vadSession.status === "starting"}
                size="sm"
              >
                Start Recording
              </Button>
              <Button
                onClick={() => stopRecording()}
                disabled={vadSession.status !== "running"}
                variant="secondary"
                size="sm"
              >
                Stop Recording
              </Button>
            </div>
          </div>
        </Card>

        {/* Current ASR Result */}
        {asrResult && (
          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-3">Current Result</h2>
            <div className="space-y-2">
              <p className="text-sm bg-muted p-2 rounded">
                {asrResult.transcript || "(empty transcript)"}
              </p>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Duration: {asrResult.durationMs}ms</span>
                <span>Sample Rate: {asrResult.sampleRate}Hz</span>
                <span>Samples: {asrResult.audio.length}</span>
              </div>
              <Button
                onClick={() => clearAsrResult(null)}
                variant="outline"
                size="sm"
              >
                Clear Result
              </Button>
            </div>
          </Card>
        )}

        {/* Transcript Log */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Transcript Log</h2>
            <Button
              onClick={() => setTranscriptLog([])}
              variant="ghost"
              size="sm"
              disabled={transcriptLog.length === 0}
            >
              Clear Log
            </Button>
          </div>
          {transcriptLog.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transcripts yet. Start recording to see results.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {transcriptLog.map((entry) => (
                <div key={entry.id} className="text-sm border-b pb-2">
                  <p className="bg-muted p-2 rounded mb-1">
                    {entry.transcript || "(empty)"}
                  </p>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Duration: {entry.durationMs}ms</span>
                    <span>
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Instructions */}
        <Card className="p-4 bg-muted/50">
          <h2 className="text-lg font-semibold mb-2">Instructions</h2>
          <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
            <li>Click "Preload Model" to load the Whisper ASR model</li>
            <li>Wait for model status to show "ready"</li>
            <li>Click "Start Recording" to begin VAD-based capture</li>
            <li>Speak into your microphone - speech probability will update in real-time</li>
            <li>When you pause, VAD will detect speech end and transcribe</li>
            <li>Results will appear in the Current Result and Transcript Log panels</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
