import { Context as CordisContext } from '@deepseek-ai/cordis'
import type { SecretCatalogValues } from '@dshfiles/credential-port'
import { DshxEffect, HostContext } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Layer } from 'effect'
import { CatalogPorts } from './catalog-ports-promise.js'
import { DshCredentials } from './dsh-credentials-promise.js'
import { catalogWithCli, catalogWithRows } from './secret-catalog-fixture.js'
import { resolveSecretValue } from './secret-reference-resolver.js'

const row = (overrides: Record<string, string>) => ({ alias: 'TOKEN', scope: 'global', env: 'prod', item: 'Item', field: 'password', ...overrides })

const reveals = (fixture: ReturnType<typeof catalogWithRows>) =>
  fixture.requests.filter(request => request.args[0] === 'get').map(request => ({ args: request.args, cwd: request.cwd }))

const resolve = (fixture: ReturnType<typeof catalogWithRows>, input: Parameters<typeof resolveSecretValue>[0]) =>
  resolveSecretValue(input).pipe(Effect.provide(fixture.layer))

/** The `secretCatalogValues` port as another plugin reads it from a real Cordis Context. */
const valuesPort = (fixture: ReturnType<typeof catalogWithCli>) =>
  Effect.gen(function* () {
    const ctx = new CordisContext()
    yield* Layer.build(
      CatalogPorts.pipe(
        Layer.provide(Layer.mergeAll(fixture.layer, DshCredentials.layerTest(undefined), HostContext.layer({ ctx, packageId: '@dshfiles/secret-catalog' }))),
      ),
    )
    const values: SecretCatalogValues | undefined = ctx.get('secretCatalogValues')
    if (values === undefined) return yield* Effect.die('The Secret Catalog did not provide secretCatalogValues.')
    return values
  })

describe('secret reference resolution', () => {
  it.effect('resolves the matching row with its own scope and environment', () =>
    Effect.gen(function* () {
      const fixture = catalogWithRows({ rows: [row({}), row({ alias: 'OTHER' })], value: 'resolved-secret-value' })
      expect(yield* resolve(fixture, { reference: { alias: 'TOKEN', environment: 'prod' }, cwd: null })).toBe('resolved-secret-value')
      expect(reveals(fixture)).toEqual([{ args: ['get', 'TOKEN', '--env', 'prod', '--config', expectGlobalConfig()], cwd: null }])
    }),
  )

  it.effect('resolves a project alias through the caller folder', () =>
    Effect.gen(function* () {
      const fixture = catalogWithRows({ rows: [row({ scope: 'project', env: 'dev' })] })
      yield* resolve(fixture, { reference: { alias: 'TOKEN', environment: 'dev' }, cwd: '/tmp/project' })
      expect(reveals(fixture)).toEqual([{ args: ['get', 'TOKEN', '--env', 'dev'], cwd: '/tmp/project' }])
    }),
  )

  it.effect('rejects a scope replacement between metadata selection and resolution before reading any value', () =>
    Effect.gen(function* () {
      const fixture = catalogWithRows({ rows: [row({ scope: 'global' })] })
      const error = yield* Effect.flip(resolve(fixture, { reference: { alias: 'TOKEN', environment: 'prod' }, cwd: '/tmp/project', expectedScope: 'project' }))
      expect(error.message).toContain('scope changed')
      expect(reveals(fixture)).toEqual([])
    }),
  )

  it.effect('names the alias and environment when nothing matches, without revealing', () =>
    Effect.gen(function* () {
      const fixture = catalogWithRows({ rows: [row({ env: 'prod' })] })
      const error = yield* Effect.flip(resolve(fixture, { reference: { alias: 'TOKEN', environment: 'dev' }, cwd: null }))
      expect(error.message).toContain('No secret alias TOKEN is configured for environment dev.')
      expect(reveals(fixture)).toEqual([])
    }),
  )

  it.effect('refuses a duplicate alias rather than guessing its scope', () =>
    Effect.gen(function* () {
      const fixture = catalogWithRows({ rows: [row({ scope: 'global' }), row({ scope: 'project' })] })
      const error = yield* Effect.flip(resolve(fixture, { reference: { alias: 'TOKEN', environment: 'prod' }, cwd: '/tmp/project' }))
      expect(error.message).toContain('exists in several scopes')
      expect(reveals(fixture)).toEqual([])
    }),
  )

  it.effect('records a secret resolve span with the alias, environment and scope, never the value', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const fixture = catalogWithRows({ rows: [row({ scope: 'project' })], value: 'resolved-secret-value' })
      yield* resolve(fixture, { reference: { alias: 'TOKEN', environment: 'prod' }, cwd: '/private/tmp/project' })
      const span = recorder.span('secret resolve')
      expect(span.attributes).toMatchObject({ 'secret.alias': 'TOKEN', 'secret.environment': 'prod', 'secret.project_scoped': true, 'secret.scope': 'project' })
      expect(JSON.stringify(span.attributes)).not.toContain('resolved-secret-value')
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )

  it.effect('advertises exact-scope enforcement on the Host port and reveals only the selected scope', () =>
    Effect.gen(function* () {
      const fixture = catalogWithRows({ rows: [row({ scope: 'project' })], value: 'resolved-secret-value' })
      const values = yield* valuesPort(fixture)
      expect(values.supportsExpectedScope).toBe(true)
      const value = yield* Effect.promise(() =>
        values.resolve({ reference: { alias: 'TOKEN', environment: 'prod' }, cwd: '/tmp/project', expectedScope: 'project' }),
      )
      expect(value).toBe('resolved-secret-value')
      expect(reveals(fixture)).toEqual([{ args: ['get', 'TOKEN', '--env', 'prod'], cwd: '/tmp/project' }])
    }).pipe(Effect.scoped),
  )

  it.live('aborts a port resolution and its CLI read with the caller signal', () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const fixture = catalogWithCli(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        ),
      )
      const values = yield* valuesPort(fixture)
      const controller = new AbortController()
      const reason = new Error('reference request cancelled')
      const pending = values.resolve({ reference: { alias: 'TOKEN', environment: 'prod' }, cwd: null, signal: controller.signal })
      yield* Deferred.await(started)
      controller.abort(reason)
      const rejection = yield* Effect.promise(() =>
        pending.then(
          () => undefined,
          (error: unknown) => error,
        ),
      )
      expect(rejection).toBe(reason)
      yield* Deferred.await(interrupted)
    }).pipe(Effect.scoped),
  )
})

const expectGlobalConfig = () => expect.stringMatching(/\.config\/secret\/config\.json$/)
