import { encodeJson } from "./codec";
import { HttpErrorResponse } from "../domain/HttpProtocol";
import {
  AudioUploadFailed,
  InvalidTurnSubmission,
  TurnstileFailed
} from "./handlers";
import { DbError } from "../services/Db";

export const toHttpError = (error: unknown): { status: number; body: HttpErrorResponse } => {
  if (error && typeof error === "object" && "_tag" in error) {
    switch (error._tag) {
      case "InvalidTurnSubmission":
        return {
          status: 400,
          body: new HttpErrorResponse({
            code: "invalid_turn_submission",
            message: (error as InvalidTurnSubmission).reason,
            retryable: false
          })
        };
      case "TurnstileFailed":
        return {
          status: 403,
          body: new HttpErrorResponse({
            code: "turnstile_failed",
            message: (error as TurnstileFailed).reason,
            retryable: false
          })
        };
      case "AudioUploadFailed": {
        const reason = (error as AudioUploadFailed).reason;
        const isNotFound = typeof reason === "string" && reason.includes("turn_not_found");
        return {
          status: isNotFound ? 404 : 400,
          body: new HttpErrorResponse({
            code: isNotFound ? "turn_not_found" : "audio_upload_failed",
            message: reason,
            retryable: false
          })
        };
      }
      case "DbError": {
        const reason = (error as DbError).reason;
        const notFound =
          reason === "scenario_not_found" ||
          reason === "room_not_found" ||
          reason === "turn_not_found";
        return {
          status: notFound ? 404 : 500,
          body: new HttpErrorResponse({
            code: notFound ? reason : "db_error",
            message: reason,
            retryable: false
          })
        };
      }
    }
  }
  return {
    status: 500,
    body: new HttpErrorResponse({
      code: "internal_error",
      message: String(error),
      retryable: false
    })
  };
};

export const toHttpErrorResponse = (error: unknown): Response => {
  const { status, body } = toHttpError(error);
  return new Response(encodeJson(HttpErrorResponse, body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
};
