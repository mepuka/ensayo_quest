/**
 * Effect + Cloudflare Vitest Integration
 *
 * Provides Effect-native testing patterns for Cloudflare Workers.
 * Uses @cloudflare/vitest-pool-workers for the runtime and wraps
 * cloudflare:test APIs in Effect services.
 *
 * @example
 * ```ts
 * import { describe, it, expect } from "vitest";
 * import { effectTest, CloudflareTestContext } from "./effect-vitest-cloudflare";
 *
 * describe("RoomDurableObject", () => {
 *   it("creates a room", () =>
 *     effectTest(
 *       Effect.gen(function* () {
 *         const ctx = yield* CloudflareTestContext;
 *         const stub = ctx.env.ROOMS.get(ctx.env.ROOMS.idFromName("test"));
 *         const result = yield* Effect.promise(() => stub.createRoom({ topic: "travel", level: "A2" }));
 *         expect(result.roomId).toBeDefined();
 *       })
 *     )
 *   );
 * });
 * ```
 */
import { Context, Effect, Layer, Scope, Runtime, Exit } from "effect";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Environment bindings available in tests.
 * Extend this interface in your test files to add project-specific bindings.
 */
export interface TestEnv {
  [key: string]: unknown;
}

/**
 * Cloudflare test context providing access to bindings and test utilities.
 */
export interface CloudflareTestContextShape {
  /** Environment bindings from cloudflare:test */
  readonly env: TestEnv;

  /**
   * Run code inside a Durable Object instance.
   * Provides direct access to DO state for testing.
   */
  readonly runInDurableObject: <R>(
    stub: unknown,
    callback: (instance: unknown, state: unknown) => R | Promise<R>
  ) => Effect.Effect<R>;

  /**
   * Trigger a Durable Object's alarm immediately.
   * Returns true if an alarm ran.
   */
  readonly runDurableObjectAlarm: (stub: unknown) => Effect.Effect<boolean>;

  /**
   * List all Durable Object IDs in a namespace.
   */
  readonly listDurableObjectIds: (namespace: unknown) => Effect.Effect<readonly string[]>;

  /**
   * Service binding to the main worker.
   */
  readonly SELF: unknown;
}

// =============================================================================
// CloudflareTestContext Service
// =============================================================================

/**
 * Effect service providing access to Cloudflare test utilities.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const ctx = yield* CloudflareTestContext;
 *   const stub = ctx.env.ROOMS.get(ctx.env.ROOMS.idFromName("test"));
 *   yield* ctx.runInDurableObject(stub, (instance, state) => {
 *     // Access DO internals
 *   });
 * });
 * ```
 */
export class CloudflareTestContext extends Context.Tag("CloudflareTestContext")<
  CloudflareTestContext,
  CloudflareTestContextShape
>() {
  /**
   * Live layer that provides cloudflare:test bindings.
   * Must be used within @cloudflare/vitest-pool-workers runtime.
   */
  static readonly Live = Layer.effect(
    CloudflareTestContext,
    Effect.gen(function* () {
      // Dynamic import to work in workerd runtime
      const cfTest = yield* Effect.promise(async () => {
        // @ts-expect-error - cloudflare:test is provided by vitest-pool-workers
        const mod = await import("cloudflare:test");
        return mod as {
          env: TestEnv;
          SELF: unknown;
          runInDurableObject: <R>(
            stub: unknown,
            callback: (instance: unknown, state: unknown) => R | Promise<R>
          ) => Promise<R>;
          runDurableObjectAlarm: (stub: unknown) => Promise<boolean>;
          listDurableObjectIds: (namespace: unknown) => Promise<Array<{ toString(): string }>>;
        };
      });

      return {
        env: cfTest.env,
        SELF: cfTest.SELF,

        runInDurableObject: <R>(
          stub: unknown,
          callback: (instance: unknown, state: unknown) => R | Promise<R>
        ): Effect.Effect<R> => Effect.promise(() => cfTest.runInDurableObject(stub, callback)),

        runDurableObjectAlarm: (stub: unknown): Effect.Effect<boolean> =>
          Effect.promise(() => cfTest.runDurableObjectAlarm(stub)),

        listDurableObjectIds: (namespace: unknown): Effect.Effect<readonly string[]> =>
          Effect.promise(async () => {
            const ids = await cfTest.listDurableObjectIds(namespace);
            return ids.map((id) => id.toString());
          }),
      };
    })
  );
}

// =============================================================================
// Test Runner Utilities
// =============================================================================

/**
 * Run an Effect as a test, providing CloudflareTestContext automatically.
 *
 * This is the main entry point for Effect-native Cloudflare tests.
 *
 * @example
 * ```ts
 * import { effectTest } from "./effect-vitest-cloudflare";
 *
 * it("my test", () =>
 *   effectTest(
 *     Effect.gen(function* () {
 *       const ctx = yield* CloudflareTestContext;
 *       // ... test logic
 *     })
 *   )
 * );
 * ```
 */
export const effectTest = <A, E>(
  effect: Effect.Effect<A, E, CloudflareTestContext>,
  options?: { timeout?: number }
): Promise<A> => {
  const program = effect.pipe(Effect.provide(CloudflareTestContext.Live));
  return Effect.runPromise(program);
};

/**
 * Run an Effect with additional layers provided.
 *
 * @example
 * ```ts
 * const MyServiceTest = Layer.succeed(MyService, mockImplementation);
 *
 * it("my test", () =>
 *   effectTestWith(MyServiceTest)(
 *     Effect.gen(function* () {
 *       const svc = yield* MyService;
 *       // ... test logic
 *     })
 *   )
 * );
 * ```
 */
export const effectTestWith = <ROut, E2, RIn>(layer: Layer.Layer<ROut, E2, RIn>) => {
  return <A, E>(
    effect: Effect.Effect<A, E, CloudflareTestContext | ROut>,
    _options?: { timeout?: number }
  ): Promise<A> => {
    const fullLayer = Layer.provideMerge(layer, CloudflareTestContext.Live);
    const program = effect.pipe(Effect.provide(fullLayer));
    return Effect.runPromise(program as Effect.Effect<A, E | E2, never>);
  };
};

/**
 * Create a shared layer context for a describe block.
 * Similar to @effect/vitest's layer() function.
 *
 * The layer is built once in beforeAll and cleaned up in afterAll.
 *
 * @example
 * ```ts
 * import { describe, beforeAll, afterAll, it, expect } from "vitest";
 * import { createTestContext, CloudflareTestContext } from "./effect-vitest-cloudflare";
 *
 * describe("RoomDurableObject", () => {
 *   const ctx = createTestContext(
 *     Layer.provideMerge(MyService.TestLayer, CloudflareTestContext.Live)
 *   );
 *
 *   beforeAll(ctx.setup);
 *   afterAll(ctx.teardown);
 *
 *   it("test", () =>
 *     ctx.run(
 *       Effect.gen(function* () {
 *         const svc = yield* MyService;
 *         // ... test
 *       })
 *     )
 *   );
 * });
 * ```
 */
export const createTestContext = <R, E>(layer: Layer.Layer<R, E>) => {
  let runtime: Runtime.Runtime<R> | null = null;
  let scope: Scope.CloseableScope | null = null;

  const setup = async () => {
    scope = Effect.runSync(Scope.make());
    runtime = await Effect.runPromise(
      Layer.toRuntime(layer).pipe(Scope.extend(scope))
    );
  };

  const teardown = async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      scope = null;
      runtime = null;
    }
  };

  const run = <A, E2>(effect: Effect.Effect<A, E2, R>): Promise<A> => {
    if (!runtime) {
      throw new Error("Test context not initialized. Call setup() in beforeAll.");
    }
    return Runtime.runPromise(runtime)(effect);
  };

  return { setup, teardown, run };
};

// =============================================================================
// Durable Object Test Helpers
// =============================================================================

/**
 * Create a Durable Object stub for testing.
 *
 * @example
 * ```ts
 * const stub = yield* getDurableObjectStub(ctx.env.ROOMS, "test-room-id");
 * ```
 */
export const getDurableObjectStub = (
  namespace: { get: (id: unknown) => unknown; idFromName: (name: string) => unknown },
  name: string
): Effect.Effect<unknown> => Effect.sync(() => namespace.get(namespace.idFromName(name)));

/**
 * Assert that a Durable Object's storage contains expected data.
 *
 * @example
 * ```ts
 * yield* assertDurableObjectStorage(ctx, stub, async (instance, state) => {
 *   const count = state.storage.sql.exec("SELECT COUNT(*) FROM events").one();
 *   expect(count).toBeGreaterThan(0);
 * });
 * ```
 */
export const assertDurableObjectStorage = (
  ctx: CloudflareTestContextShape,
  stub: unknown,
  assertion: (instance: unknown, state: unknown) => void | Promise<void>
): Effect.Effect<void> =>
  ctx.runInDurableObject(stub, async (instance, state) => {
    await assertion(instance, state);
  });
