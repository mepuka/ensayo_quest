/**
 * ConnectionStatus - Sync indicator and reconnect button
 *
 * Shows connection state with ability to reconnect.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - GameSession section
 */
import { useConnection } from "../../hooks";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export interface ConnectionStatusProps {
  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Connection status indicator with reconnect control.
 *
 * Shows:
 * - Connection status (connected/reconnecting/disconnected)
 * - Sync state (synced/syncing/stale)
 * - Reconnect button when disconnected
 */
export function ConnectionStatus({ className }: ConnectionStatusProps) {
  const { status, syncState, reconnect, isConnected, isReconnecting } = useConnection();

  const statusVariant = isConnected
    ? "default"
    : isReconnecting
      ? "secondary"
      : "destructive";

  const syncVariant = syncState === "synced"
    ? "outline"
    : syncState === "syncing"
      ? "secondary"
      : "destructive";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Badge variant={statusVariant}>
        {status}
      </Badge>

      <Badge variant={syncVariant}>
        {syncState}
      </Badge>

      {!isConnected && !isReconnecting && (
        <Button
          variant="outline"
          size="sm"
          onClick={reconnect}
        >
          Reconnect
        </Button>
      )}
    </div>
  );
}
