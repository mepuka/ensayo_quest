/**
 * DO SQLite Client with No-Op Transactions
 *
 * Cloudflare Durable Object SQLite does NOT support direct SQL transaction
 * statements like BEGIN/COMMIT/ROLLBACK. Instead, it requires using the
 * transactionSync() or transaction() methods on ctx.storage.
 *
 * The @effect/sql-sqlite-do package uses the default transaction commands
 * which fail in DO SQLite. This module provides a layer that uses no-op
 * statements (SELECT 1) for transaction commands, relying on DO's automatic
 * write coalescing for atomicity.
 *
 * @see https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/
 */
import type { SqlStorage } from "@cloudflare/workers-types";
import * as Reactivity from "@effect/experimental/Reactivity";
import * as Client from "@effect/sql/SqlClient";
import type { Connection } from "@effect/sql/SqlConnection";
import { SqlError } from "@effect/sql/SqlError";
import * as Statement from "@effect/sql/Statement";
import * as Chunk from "effect/Chunk";
import * as Config from "effect/Config";
import type { ConfigError } from "effect/ConfigError";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

const ATTR_DB_SYSTEM_NAME = "db.system.name";

/**
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("@effect/sql-sqlite-do/SqliteClient/NoTx");

/**
 * @category type ids
 */
export type TypeId = typeof TypeId;

/**
 * @category models
 */
export interface SqliteClientNoTx extends Client.SqlClient {
  readonly [TypeId]: TypeId;
  readonly config: SqliteClientNoTxConfig;

  /** Not supported in sqlite */
  readonly updateValues: never;
}

/**
 * @category tags
 */
export const SqliteClientNoTx = Context.GenericTag<SqliteClientNoTx>(
  "@effect/sql-sqlite-do/SqliteClient/NoTx"
);

/**
 * @category models
 */
export interface SqliteClientNoTxConfig {
  readonly db: SqlStorage;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
}

/**
 * @category constructor
 */
export const make = Effect.fn("DoSqliteClientNoTx.make")(function* (
  options: SqliteClientNoTxConfig
) {
    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined;

    const makeConnection = Effect.gen(function* () {
      const db = options.db;

      function* runIterator(sql: string, params: ReadonlyArray<unknown> = []) {
        const cursor = db.exec(sql, ...params);
        const columns = cursor.columnNames;
        for (const result of cursor.raw()) {
          const obj: any = {};
          for (let i = 0; i < columns.length; i++) {
            const value = result[i];
            const columnName = columns[i];
            if (columnName !== undefined) {
              obj[columnName] = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
            }
          }
          yield obj;
        }
      }

      const runStatement = (
        sql: string,
        params: ReadonlyArray<unknown> = []
      ): Effect.Effect<ReadonlyArray<any>, SqlError, never> =>
        Effect.try({
          try: () => Array.from(runIterator(sql, params)),
          catch: (cause) => new SqlError({ cause, message: `Failed to execute statement` })
        });

      const runValues = (
        sql: string,
        params: ReadonlyArray<unknown> = []
      ): Effect.Effect<ReadonlyArray<any>, SqlError, never> =>
        Effect.try({
          try: () =>
            Array.from(db.exec(sql, ...params).raw(), (row) => {
              for (let i = 0; i < row.length; i++) {
                const value = row[i];
                if (value instanceof ArrayBuffer) {
                  row[i] = new Uint8Array(value) as any;
                }
              }
              return row;
            }),
          catch: (cause) => new SqlError({ cause, message: `Failed to execute statement` })
        });

      return identity<Connection>({
        execute(sql, params, transformRows) {
          return transformRows
            ? Effect.map(runStatement(sql, params), transformRows)
            : runStatement(sql, params);
        },
        executeRaw(sql, params) {
          return runStatement(sql, params);
        },
        executeValues(sql, params) {
          return runValues(sql, params);
        },
        executeUnprepared(sql, params, transformRows) {
          return transformRows
            ? Effect.map(runStatement(sql, params), transformRows)
            : runStatement(sql, params);
        },
        executeStream(sql, params, transformRows) {
          return Stream.suspend(() => {
            const iterator = runIterator(sql, params);
            return Stream.fromIteratorSucceed(iterator, 16);
          }).pipe(
            transformRows
              ? Stream.mapChunks((chunk) =>
                  Chunk.unsafeFromArray(transformRows(Chunk.toReadonlyArray(chunk)))
                )
              : identity
          );
        }
      });
    });

    const semaphore = yield* Effect.makeSemaphore(1);
    const connection = yield* makeConnection;

    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection));
    const transactionAcquirer = Effect.uninterruptibleMask((restore) =>
      Effect.as(
        Effect.zipRight(
          restore(semaphore.take(1)),
          Effect.tap(Effect.scope, (scope) => Scope.addFinalizer(scope, semaphore.release(1)))
        ),
        connection
      )
    );

    return Object.assign(
      (yield* Client.make({
        acquirer,
        compiler,
        transactionAcquirer,
        spanAttributes: [
          ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
          [ATTR_DB_SYSTEM_NAME, "sqlite"]
        ],
        transformRows,
        // NO-OP transaction commands for DO SQLite
        // DO SQLite doesn't support BEGIN/COMMIT/ROLLBACK - it uses transactionSync() instead
        // Using SELECT 1 as a valid no-op statement
        beginTransaction: "SELECT 1",
        commit: "SELECT 1",
        rollback: "SELECT 1",
        savepoint: (_name: string) => "SELECT 1",
        rollbackSavepoint: (_name: string) => "SELECT 1"
      })) as SqliteClientNoTx,
      {
        [TypeId]: TypeId as TypeId,
        config: options
      }
    );
  });

/**
 * @category layers
 */
export const layerConfig = (
  config: Config.Config.Wrap<SqliteClientNoTxConfig>
): Layer.Layer<SqliteClientNoTx | Client.SqlClient, ConfigError> =>
  Layer.scopedContext(
    Config.unwrap(config).pipe(
      Effect.flatMap(make),
      Effect.map((client) =>
        Context.make(SqliteClientNoTx, client).pipe(Context.add(Client.SqlClient, client))
      )
    )
  ).pipe(Layer.provide(Reactivity.layer));

/**
 * @category layers
 */
export const layer = (
  config: SqliteClientNoTxConfig
): Layer.Layer<SqliteClientNoTx | Client.SqlClient, ConfigError> =>
  Layer.scopedContext(
    Effect.map(make(config), (client) =>
      Context.make(SqliteClientNoTx, client).pipe(Context.add(Client.SqlClient, client))
    )
  ).pipe(Layer.provide(Reactivity.layer));
