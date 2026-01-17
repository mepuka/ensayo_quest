/**
 * Shared Components Barrel Export
 *
 * Reusable UI components for the application.
 *
 * @see docs/plans/2026-01-17-frontend-state-components-design.md - Shared components
 */

// Async button with Effect Result loading state
export { AsyncButton, type AsyncButtonProps } from "./AsyncButton";

// Status badges for connection, sync, recording phase
export {
  ConnectionBadge,
  SyncBadge,
  RecordingPhaseBadge,
  type ConnectionBadgeProps,
  type SyncBadgeProps,
  type RecordingPhaseBadgeProps
} from "./StatusBadge";

// Error display components
export {
  ErrorMessage,
  ResultError,
  type ErrorMessageProps,
  type ResultErrorProps
} from "./ErrorMessage";

// Audio visualization
export { Waveform, type WaveformProps } from "./Waveform";

// Recording button with phase-aware animation
export { RecordingButton, type RecordingButtonProps } from "./RecordingButton";

// Conversation display
export {
  ConversationBubble,
  ConversationList,
  type ConversationBubbleProps,
  type ConversationListProps
} from "./ConversationBubble";
