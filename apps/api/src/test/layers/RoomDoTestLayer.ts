/**
 * RoomDoTestLayer - Mock RoomDoClient for testing.
 *
 * Provides configurable mock for Durable Object event emission with callback hooks.
 *
 * @example
 * ```ts
 * const emittedEvents: Array<{ roomId: string; event: RoomEvent }> = [];
 * const layer = makeRoomDoTestLayer({
 *   onEmit: (roomId, event) => emittedEvents.push({ roomId, event })
 * });
 * ```
 */
import { Effect, Layer } from "effect";
import { RoomDoClient, type RoomDoClientService } from "../../services/RoomDoClient";
import type { RoomEvent } from "../../domain/RoomProtocol";

// =============================================================================
// Configuration
// =============================================================================

export interface RoomDoTestConfig {
  /** Callback when emitRoomEvent is called */
  onEmit?: (roomId: string, event: RoomEvent, stateJson?: string) => void;
  /** If true, emitRoomEvent will fail with an error */
  shouldFail?: boolean;
  /** Error message when shouldFail is true */
  failReason?: string;
}

// =============================================================================
// RoomDoTestLayer Factory
// =============================================================================

/**
 * Create a RoomDoClient mock layer with configurable behavior.
 */
export const makeRoomDoTestLayer = (config: RoomDoTestConfig = {}) => {
  const { onEmit, shouldFail = false, failReason = "mock_error" } = config;

  return Layer.succeed(RoomDoClient, {
    emitRoomEvent: (roomId, event, stateJson) => {
      if (shouldFail) {
        return Effect.fail({ _tag: "RoomDoClientError", reason: failReason } as const);
      }

      return Effect.sync(() => {
        onEmit?.(roomId, event, stateJson);
      });
    }
  } satisfies RoomDoClientService);
};

// =============================================================================
// Presets
// =============================================================================

/** Default mock that succeeds silently */
export const RoomDoTestLayerDefault = makeRoomDoTestLayer();

/** Mock that fails all emit calls */
export const RoomDoTestLayerFailing = makeRoomDoTestLayer({
  shouldFail: true,
  failReason: "room_do_unavailable"
});
