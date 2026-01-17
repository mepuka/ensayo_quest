import type { SqlStorage } from "@cloudflare/workers-types";
import * as EventLogServer from "@effect/experimental/EventLogServer";
import { layerSubtle as EventLogEncryptionLayer } from "@effect/experimental/EventLogEncryption";
import * as SqlEventLogServer from "@effect/sql/SqlEventLogServer";
import * as Config from "effect/Config";
import { Layer } from "effect";
import { layerConfig as DoSqliteNoTxLayerConfig } from "./db/DoSqliteClientNoTx";

/**
 * Create the EventLogServer.Storage layer.
 * Uses SqlEventLogServer which creates tables for remote sync.
 */
export const makeEventLogStorageLayer = (options?: {
  readonly entryTablePrefix?: string;
  readonly remoteIdTable?: string;
  readonly insertBatchSize?: number;
}) =>
  Layer.scoped(EventLogServer.Storage, SqlEventLogServer.makeStorage(options)).pipe(
    Layer.provide(EventLogEncryptionLayer)
  );

/**
 * Create DO SQLite EventLog storage layer.
 *
 * Uses the no-tx client because SqlEventLogServer.makeStorage() uses transactions
 * (INSERT with ON CONFLICT), and Cloudflare DO SQLite doesn't support direct
 * BEGIN/COMMIT/ROLLBACK statements.
 */
export const makeDoSqliteEventLogStorageLayer = (
  storage: SqlStorage,
  options?: {
    readonly entryTablePrefix?: string;
    readonly remoteIdTable?: string;
    readonly insertBatchSize?: number;
  }
) =>
  makeEventLogStorageLayer(options).pipe(
    Layer.provide(DoSqliteNoTxLayerConfig(Config.succeed({ db: storage })))
  );

/**
 * Create DO SQLite EventLog runtime layer with all dependencies.
 *
 * Uses the no-tx client for DO SQLite compatibility.
 */
export const makeDoSqliteEventLogRuntimeLayer = (
  storage: SqlStorage,
  options?: {
    readonly entryTablePrefix?: string;
    readonly remoteIdTable?: string;
    readonly insertBatchSize?: number;
  }
) => {
  const sqliteLayer = DoSqliteNoTxLayerConfig(Config.succeed({ db: storage }));
  const storageLayer = makeEventLogStorageLayer(options).pipe(Layer.provide(sqliteLayer));
  // Include encryption layer for functions that directly use EventLogEncryption
  return Layer.mergeAll(sqliteLayer, storageLayer, EventLogEncryptionLayer);
};
