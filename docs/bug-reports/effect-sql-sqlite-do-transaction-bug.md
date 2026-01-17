# @effect/sql-sqlite-do: withTransaction fails on Cloudflare DO SQLite

## What version of Effect is running?

3.19.14

## What steps can reproduce the bug?

Use `@effect/sql-sqlite-do` with any code that calls `sql.withTransaction`, such as `SqlEventJournal`:

```typescript
import { SqliteClient } from "@effect/sql-sqlite-do"
import * as SqlEventJournal from "@effect/sql/SqlEventJournal"
import * as EventLog from "@effect/experimental/EventLog"
import * as Config from "effect/Config"
import * as Layer from "effect/Layer"

// In a Durable Object constructor:
export class MyDurableObject extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    const storage = ctx.storage.sql
    const sqlLayer = SqliteClient.layerConfig(Config.succeed({ db: storage }))

    // SqlEventJournal.make() creates tables fine, but...
    const journalLayer = SqlEventJournal.layer({
      entryTable: "events",
      remotesTable: "remotes"
    }).pipe(Layer.provide(sqlLayer))

    // When you later call journal.write(), it uses sql.withTransaction
    // which executes "BEGIN" - and that fails in DO SQLite
  }
}
```

The error occurs when `SqlEventJournal.write()` is called, which internally uses `sql.withTransaction`.

## What is the expected behavior?

`sql.withTransaction` should work in Cloudflare Durable Object SQLite, or the `@effect/sql-sqlite-do` package should handle DO SQLite's transaction limitations.

Cloudflare DO SQLite does not support direct SQL transaction statements (`BEGIN`, `COMMIT`, `ROLLBACK`). From [Cloudflare's documentation](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/):

> "sql.exec() cannot execute transaction-related statements like BEGIN TRANSACTION or SAVEPOINT."

However, DO SQLite provides **automatic write coalescing** - any series of synchronous writes are automatically atomic. So transactions can safely be no-ops.

## What do you see instead?

```
SqlError: Failed to execute statement
```

The underlying cause is that `BEGIN` is not a valid statement in DO SQLite.

**Root cause in code:**

In `@effect/sql-sqlite-do/src/SqliteClient.ts`, the `make` function calls `Client.make()` without overriding transaction commands:

```typescript
return Object.assign(
  (yield* Client.make({
    acquirer,
    compiler,
    transactionAcquirer,
    spanAttributes: [...],
    transformRows
    // Missing: beginTransaction, commit, rollback, savepoint, rollbackSavepoint
  })) as SqliteClient,
  ...
)
```

This uses the defaults from `@effect/sql/internal/client.ts`:
```typescript
beginTransaction = "BEGIN",
commit = "COMMIT",
rollback = "ROLLBACK",
```

**Proposed fix:**

Set no-op transaction commands since DO SQLite's automatic write coalescing provides atomicity:

```typescript
return Object.assign(
  (yield* Client.make({
    acquirer,
    compiler,
    transactionAcquirer,
    spanAttributes: [...],
    transformRows,
    // No-op for DO SQLite (automatic write coalescing handles atomicity)
    beginTransaction: "SELECT 1",
    commit: "SELECT 1",
    rollback: "SELECT 1",
    savepoint: (_name: string) => "SELECT 1",
    rollbackSavepoint: (_name: string) => "SELECT 1"
  })) as SqliteClient,
  ...
)
```

**Note:** `SqlEventLogServer.makeStorage()` works fine because it doesn't use `withTransaction`. The issue specifically affects `SqlEventJournal` and any user code using explicit transactions.

## Additional context

- Related: #3888 (D1 batch support - similar Cloudflare SQL limitation)
- Cloudflare docs: [DO SQLite Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- Cloudflare blog explaining why: ["If BEGIN TRANSACTION were permitted, any one Worker request anywhere in the world could effectively block your whole database"](https://blog.cloudflare.com/whats-new-with-d1/)

**Workaround:** We created a custom client layer that sets no-op transaction commands. Happy to submit a PR if this approach is acceptable.
