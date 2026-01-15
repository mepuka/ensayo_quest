import * as Schema from "effect/Schema";
import { RoomError } from "./RoomProtocol";

export class HttpValidationError extends Schema.TaggedError<HttpValidationError>()(
  "HttpValidationError",
  { reason: Schema.String }
) {}

export class HttpUnauthorized extends Schema.TaggedError<HttpUnauthorized>()("HttpUnauthorized", {
  reason: Schema.String
}) {}

export class HttpRateLimited extends Schema.TaggedError<HttpRateLimited>()("HttpRateLimited", {
  retryAfterMs: Schema.Number
}) {}

export class WsInvalidEvent extends Schema.TaggedError<WsInvalidEvent>()("WsInvalidEvent", {
  reason: Schema.String
}) {}

export class WsDuplicateTurn extends Schema.TaggedError<WsDuplicateTurn>()("WsDuplicateTurn", {
  turnId: Schema.String
}) {}

export class WsOutOfOrder extends Schema.TaggedError<WsOutOfOrder>()("WsOutOfOrder", {
  expectedSequence: Schema.Number,
  actualSequence: Schema.Number
}) {}

export class RoomStateError extends Schema.TaggedError<RoomStateError>()("RoomStateError", {
  reason: Schema.String
}) {}

export type ProtocolError =
  | HttpValidationError
  | HttpUnauthorized
  | HttpRateLimited
  | WsInvalidEvent
  | WsDuplicateTurn
  | WsOutOfOrder
  | RoomStateError;

export const toRoomErrorEvent = (error: ProtocolError): RoomError => {
  switch (error._tag) {
    case "HttpValidationError":
      return new RoomError({
        type: "Error",
        code: "http_validation_error",
        message: error.reason,
        retryable: false
      });
    case "HttpUnauthorized":
      return new RoomError({
        type: "Error",
        code: "http_unauthorized",
        message: error.reason,
        retryable: false
      });
    case "HttpRateLimited":
      return new RoomError({
        type: "Error",
        code: "http_rate_limited",
        message: "rate_limited",
        retryable: true
      });
    case "WsInvalidEvent":
      return new RoomError({
        type: "Error",
        code: "ws_invalid_event",
        message: error.reason,
        retryable: false
      });
    case "WsDuplicateTurn":
      return new RoomError({
        type: "Error",
        code: "ws_duplicate_turn",
        message: error.turnId,
        retryable: false
      });
    case "WsOutOfOrder":
      return new RoomError({
        type: "Error",
        code: "ws_out_of_order",
        message: `${error.expectedSequence}:${error.actualSequence}`,
        retryable: false
      });
    case "RoomStateError":
      return new RoomError({
        type: "Error",
        code: "room_state_error",
        message: error.reason,
        retryable: false
      });
  }
};
