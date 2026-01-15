import type { SqlStorage } from "@cloudflare/workers-types";
import { EventLogDurableObject } from "@effect/experimental/EventLogServer/Cloudflare";
import type { CloudflareEnv } from "../services/Env";
import { makeDoSqliteEventLogRuntimeLayer, makeDoSqliteEventLogStorageLayer } from "./EventLogStorage";
import { decodeRoomEventEnvelopeMsgPack } from "../domain/RoomProtocol";
import { appendRoomEventWithState } from "./RoomEventAppender";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Layer from "effect/Layer";
import { applyRoomSchema } from "./db/schema";

export class RoomDurableObject extends EventLogDurableObject {
  private readonly roomRuntime: ManagedRuntime.ManagedRuntime<any, never>;
  private readonly schemaReady: Promise<void>;

  constructor(state: DurableObjectState, env: CloudflareEnv) {
    const storage = (state.storage as DurableObjectStorage & { sql: SqlStorage }).sql;
    super({
      ctx: state,
      env,
      storageLayer: makeDoSqliteEventLogStorageLayer(storage).pipe(Layer.orDie)
    });
    this.roomRuntime = ManagedRuntime.make(
      makeDoSqliteEventLogRuntimeLayer(storage).pipe(Layer.orDie)
    );
    this.schemaReady = this.roomRuntime.runPromise(applyRoomSchema);
  }

  override async fetch(request?: Request): Promise<Response> {
    await this.schemaReady;
    if (!request || request.headers.get("Upgrade") === "websocket") {
      return super.fetch();
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const body = new Uint8Array(await request.arrayBuffer());
    const envelope = decodeRoomEventEnvelopeMsgPack(body);
    await this.roomRuntime.runPromise(
      appendRoomEventWithState(
        envelope.roomId,
        envelope.event,
        envelope.stateJson
      )
    );
    return new Response(null, { status: 204 });
  }
}
