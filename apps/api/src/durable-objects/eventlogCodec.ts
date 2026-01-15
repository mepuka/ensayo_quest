import * as EventLogRemote from "@effect/experimental/EventLogRemote";

export const encodeEventLogRequest = (
  request: typeof EventLogRemote.ProtocolRequest.Type
): Uint8Array => EventLogRemote.encodeRequest(request);

export const decodeEventLogRequest = (
  input: Uint8Array
): typeof EventLogRemote.ProtocolRequest.Type => EventLogRemote.decodeRequest(input);

export const encodeEventLogResponse = (
  response: typeof EventLogRemote.ProtocolResponse.Type
): Uint8Array => EventLogRemote.encodeResponse(response);

export const decodeEventLogResponse = (
  input: Uint8Array
): typeof EventLogRemote.ProtocolResponse.Type => EventLogRemote.decodeResponse(input);
