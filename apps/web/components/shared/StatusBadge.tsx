/**
 * StatusBadge - Connection and phase status indicators
 *
 * Uses Effect Match for status-to-variant mapping.
 * Wraps shadcn Badge with semantic coloring.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Shared components
 */
import * as React from "react";
import { Match } from "effect";
import { Badge } from "../ui/badge";
import type { ConnectionStatus, RecordingPhase, SyncState } from "../../atoms";

// =============================================================================
// Connection Status Badge
// =============================================================================

export interface ConnectionBadgeProps {
  status: ConnectionStatus;
}

/**
 * Badge showing WebSocket connection status.
 */
export function ConnectionBadge({ status }: ConnectionBadgeProps) {
  const { variant, label } = Match.value(status).pipe(
    Match.when("connected", () => ({
      variant: "default" as const,
      label: "Connected"
    })),
    Match.when("connecting", () => ({
      variant: "secondary" as const,
      label: "Connecting..."
    })),
    Match.when("reconnecting", () => ({
      variant: "outline" as const,
      label: "Reconnecting..."
    })),
    Match.when("disconnected", () => ({
      variant: "destructive" as const,
      label: "Disconnected"
    })),
    Match.exhaustive
  );

  return <Badge variant={variant}>{label}</Badge>;
}

// =============================================================================
// Sync State Badge
// =============================================================================

export interface SyncBadgeProps {
  state: SyncState;
}

/**
 * Badge showing sync state (synced/syncing/stale).
 */
export function SyncBadge({ state }: SyncBadgeProps) {
  const { variant, label } = Match.value(state).pipe(
    Match.when("synced", () => ({
      variant: "default" as const,
      label: "Synced"
    })),
    Match.when("syncing", () => ({
      variant: "secondary" as const,
      label: "Syncing..."
    })),
    Match.when("stale", () => ({
      variant: "outline" as const,
      label: "Stale"
    })),
    Match.when("disconnected", () => ({
      variant: "destructive" as const,
      label: "Offline"
    })),
    Match.exhaustive
  );

  return <Badge variant={variant}>{label}</Badge>;
}

// =============================================================================
// Recording Phase Badge
// =============================================================================

export interface RecordingPhaseBadgeProps {
  phase: RecordingPhase;
}

/**
 * Badge showing recording phase.
 */
export function RecordingPhaseBadge({ phase }: RecordingPhaseBadgeProps) {
  const { variant, label } = Match.value(phase).pipe(
    Match.when("ready", () => ({
      variant: "default" as const,
      label: "Ready"
    })),
    Match.when("listening", () => ({
      variant: "default" as const,
      label: "Listening..."
    })),
    Match.when("processing", () => ({
      variant: "secondary" as const,
      label: "Processing..."
    })),
    Match.when("result", () => ({
      variant: "default" as const,
      label: "Complete"
    })),
    Match.when("not_ready", () => ({
      variant: "secondary" as const,
      label: "Loading model..."
    })),
    Match.when("no_permission", () => ({
      variant: "destructive" as const,
      label: "Mic blocked"
    })),
    Match.when("error", () => ({
      variant: "destructive" as const,
      label: "Error"
    })),
    Match.exhaustive
  );

  return <Badge variant={variant}>{label}</Badge>;
}
