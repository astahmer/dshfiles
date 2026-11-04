import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Exit, Fiber, Layer } from 'effect'
import { catalogWithCli } from './secret-catalog-fixture.js'
import { SecretCliError, type SecretCliFailureCode, type SecretCliRequest } from './secret-cli.js'
import { checkSecretReference } from './secret-reference-status.js'

const row = (overrides: Record<string, string>) => ({
  alias: 'DSH_JEV_BACKLOG',
  scope: 'global',
  env: 'prod',
  envKey: 'DSH_JEV_BACKLOG',
  item: 'global/dsh-jev-backlog',
  field: 'password',
  ...overrides,
})

const cliFailure = (code: SecretCliFailureCode) => Effect.fail(new SecretCliError({ code, cleanupConfirmed: true }))

const catalogWith = (input: {
  readonly rows?: readonly Record<string, string>[]
  readonly rowsByFolder?: Readonly<Record<string, readonly Record<string, string>[]>>
  readonly listFailure?: SecretCliFailureCode
  readonly revealFailure?: SecretCliFailureCode
  readonly value?: string
}) =>
  catalogWithCli((request: SecretCliRequest) => {
    if (request.args[0] === 'get') return input.revealFailure === undefined ? Effect.succeed(input.value ?? 'synthetic-value') : cliFailure(input.revealFailure)
    if (input.listFailure !== undefined) return cliFailure(input.listFailure)
    if (request.cwd !== null) return Effect.succeed(JSON.stringify(input.rowsByFolder?.[request.cwd] ?? []))
    return Effect.succeed(JSON.stringify(input.rows ?? []))
  })

const check = (fixture: ReturnType<typeof catalogWith>, referenceText: string, probeFolders: readonly string[] = []) =>
  checkSecretReference({ referenceText, cwd: null, probeFolders }).pipe(Effect.provide(Layer.merge(fixture.layer, NodeFileSystem.layer)))

describe('secret reference status', () => {
  it.effect('reports an empty field and a non-reference without calling the CLI', () =>
    Effect.gen(function* () {
      const fixture = catalogWith({ listFailure: 'cli-failed' })
      expect((yield* check(fixture, '  ')).state).toBe('empty')
      expect(yield* check(fixture, 'plain-text-key')).toMatchObject({ state: 'invalid-reference', alias: null })
      expect(fixture.requests).toEqual([])
    }),
  )

  it.effect('names a missing alias with its canonical reference', () =>
    Effect.gen(function* () {
      const status = yield* check(catalogWith({ rows: [row({ alias: 'OTHER' })] }), 'secret:DSH_JEV_BACKLOG')
      expect(status).toMatchObject({ state: 'alias-missing', reference: 'secret:DSH_JEV_BACKLOG', alias: 'DSH_JEV_BACKLOG', environment: 'prod' })
    }),
  )

  it.effect('interrupts primary and elsewhere list reads with the check', () =>
    Effect.gen(function* () {
      const probing = yield* Deferred.make<void>()
      const interrupted: (string | null)[] = []
      const fixture = catalogWithCli(request => {
        if (request.cwd === null) return Effect.succeed('[]')
        return Deferred.succeed(probing, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Effect.sync(() => interrupted.push(request.cwd))),
        )
      })
      const fiber = yield* Effect.forkChild(
        checkSecretReference({ referenceText: 'secret:DSH_JEV_BACKLOG', cwd: null, probeFolders: ['/work/one'] }).pipe(
          Effect.provide(Layer.merge(fixture.layer, NodeFileSystem.layer)),
        ),
      )
      yield* Deferred.await(probing)
      yield* Fiber.interrupt(fiber)
      expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true)
      expect(fixture.requests.map(request => request.cwd)).toEqual([null, '/work/one'])
      expect(interrupted).toEqual(['/work/one'])
    }),
  )

  it.effect('says the alias is missing from every scope, or names the project that holds it', () =>
    Effect.gen(function* () {
      const everywhere = yield* check(catalogWith({ rows: [] }), 'secret:DSH_JEV_BACKLOG', ['/work/one'])
      expect(everywhere).toMatchObject({ state: 'alias-missing', elsewhere: [], writeScope: 'global' })
      const projectOnly = yield* check(
        catalogWith({ rows: [], rowsByFolder: { '/work/one': [row({ scope: 'project' }), row({ alias: 'OTHER', scope: 'project' })] } }),
        'secret:DSH_JEV_BACKLOG',
        ['/work/one'],
      )
      expect(projectOnly.elsewhere).toEqual([{ scope: 'project', folder: '/work/one', environment: 'prod' }])
    }),
  )

  it.effect('lists the environments that do exist when only the environment is wrong', () =>
    Effect.gen(function* () {
      const status = yield* check(catalogWith({ rows: [row({ env: 'prod' }), row({ env: 'dev' })] }), 'secret:DSH_JEV_BACKLOG@staging')
      expect(status).toMatchObject({ state: 'environment-missing', reference: 'secret:DSH_JEV_BACKLOG@staging', environments: ['dev', 'prod'] })
    }),
  )

  it.effect('refuses to guess between scopes', () =>
    Effect.gen(function* () {
      const status = yield* check(catalogWith({ rows: [row({ scope: 'global' }), row({ scope: 'project' })] }), 'secret:DSH_JEV_BACKLOG')
      expect(status).toMatchObject({ state: 'ambiguous', scopes: ['global', 'project'] })
    }),
  )

  it.effect('resolves a unique alias whose value reads back non-empty', () =>
    Effect.gen(function* () {
      expect(yield* check(catalogWith({ rows: [row({})] }), 'secret:DSH_JEV_BACKLOG')).toMatchObject({ state: 'resolved', scope: 'global' })
    }),
  )

  it.effect('reports an unreadable or empty vault value against the matched scope', () =>
    Effect.gen(function* () {
      const unreadable = yield* check(catalogWith({ rows: [row({})], revealFailure: 'cli-failed' }), 'secret:DSH_JEV_BACKLOG')
      expect(unreadable).toMatchObject({ state: 'value-unreadable', scope: 'global' })
      expect((yield* check(catalogWith({ rows: [row({})], value: '' }), 'secret:DSH_JEV_BACKLOG')).state).toBe('value-empty')
    }),
  )

  it.effect('maps CLI failures to their typed codes', () =>
    Effect.gen(function* () {
      expect((yield* check(catalogWith({ listFailure: 'cli-missing' }), 'secret:X')).state).toBe('cli-missing')
      expect((yield* check(catalogWith({ listFailure: 'cli-timeout' }), 'secret:X')).state).toBe('cli-timeout')
      expect((yield* check(catalogWith({ listFailure: 'cli-failed' }), 'secret:X')).state).toBe('cli-failed')
      const timedOutRead = yield* check(catalogWith({ rows: [row({})], revealFailure: 'cli-timeout' }), 'secret:DSH_JEV_BACKLOG')
      expect(timedOutRead.state).toBe('cli-timeout')
    }),
  )
})
