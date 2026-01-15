import type { SqlStorage } from "@cloudflare/workers-types";
import * as EventLogServer from "@effect/experimental/EventLogServer";
import { layerSubtle as EventLogEncryptionLayer } from "@effect/experimental/EventLogEncryption";
import * as SqlEventLogServer from "@effect/sql/SqlEventLogServer";
import { SqliteClient as DoSqliteClient } from "@effect/sql-sqlite-do";
import * as Config from "effect/Config";
import { Effect, Layer } from "effect";

export const makeEventLogStorageLayer = (options?: {
  readonly entryTablePrefix?: string;
  readonly remoteIdTable?: string;
  readonly insertBatchSize?: number;
}) =>
  Layer.scoped(EventLogServer.Storage, SqlEventLogServer.makeStorage(options)).pipe(
    Layer.provide(EventLogEncryptionLayer)
  );

export const makeDoSqliteEventLogStorageLayer = (
  storage: SqlStorage,
  options?: {
    readonly entryTablePrefix?: string;
    readonly remoteIdTable?: string;
    readonly insertBatchSize?: number;
  }
) =>
  makeEventLogStorageLayer(options).pipe(
    Layer.provide(DoSqliteClient.layerConfig(Config.succeed({ db: storage })))
  );

export const makeDoSqliteEventLogRuntimeLayer = (
  storage: SqlStorage,
  options?: {
    readonly entryTablePrefix?: string;
    readonly remoteIdTable?: string;
    readonly insertBatchSize?: number;
  }
) => {
  const sqliteLayer = DoSqliteClient.layerConfig(Config.succeed({ db: storage }));
  const storageLayer = makeEventLogStorageLayer(options).pipe(Layer.provide(sqliteLayer));
  return Layer.mergeAll(sqliteLayer, storageLayer);
};
