import { homedir } from 'node:os'
import { join } from 'node:path'
import { createWorkspacePickerPorts, type WorkspacePickerRemote } from '@dshfiles/project-folder-picker'
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Exit, Fiber, Ref } from 'effect'
import { SecretCatalog } from './secret-catalog.js'
import { catalogWithCli } from './secret-catalog-fixture.js'
import { decodeSecretPrintMetadata } from './secret-metadata.js'

const globalConfig = join(homedir(), '.config', 'secret', 'config.json')

const withCatalog = <A, E>(fixture: ReturnType<typeof catalogWithCli>, body: (catalog: SecretCatalog['Service']) => Effect.Effect<A, E>) =>
  Effect.flatMap(SecretCatalog, body).pipe(Effect.provide(fixture.layer))

const answering = (text: string) => catalogWithCli(() => Effect.succeed(text))

describe('Secret Catalog metadata and exact alias actions', () => {
  it.effect('projects only value-free metadata from the CLI JSON contract', () =>
    Effect.gen(function* () {
      const rows = yield* decodeSecretPrintMetadata({
        jsonText: JSON.stringify([
          {
            alias: 'SYNTHETIC_API_TOKEN',
            scope: 'global',
            env: 'prod',
            envKey: 'SYNTHETIC_API_TOKEN',
            item: 'synthetic-service',
            field: 'password',
            value: 'synthetic-secret-must-not-cross',
          },
        ]),
        defaultScope: 'unknown',
      })
      expect(rows).toEqual([
        {
          id: '["global","SYNTHETIC_API_TOKEN","prod","synthetic-service","password"]',
          alias: 'SYNTHETIC_API_TOKEN',
          scope: 'global',
          environment: 'prod',
          variableName: 'SYNTHETIC_API_TOKEN',
          item: 'synthetic-service',
          field: 'password',
          service: 'synthetic-service',
          description: 'synthetic-service',
        },
      ])
      expect(JSON.stringify(rows)).not.toContain('synthetic-secret-must-not-cross')
    }),
  )

  it.effect('uses global-only metadata without a folder and all scope metadata with one', () => {
    const fixture = answering(JSON.stringify([{ alias: 'SYNTHETIC' }]))
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        expect(yield* catalog.list(null)).toMatchObject([{ scope: 'global', alias: 'SYNTHETIC' }])
        expect(fixture.requests.at(-1)).toEqual({ args: ['print', 'global', '--json'], cwd: null, captureStdout: true })
        expect(yield* catalog.list('/tmp/demo')).toHaveLength(1)
        expect(fixture.requests.at(-1)).toEqual({ args: ['print', '--all', '--json'], cwd: '/tmp/demo', captureStdout: true })
      }),
    )
  })

  it.effect('shares one CLI read among concurrent lists and drops it once a write starts', () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const printed = yield* Ref.make(0)
      const firstPrintStarted = yield* Deferred.make<void>()
      const fixture = catalogWithCli(request => {
        if (request.args[0] !== 'print') return Effect.succeed('')
        return Effect.gen(function* () {
          const generation = yield* Ref.updateAndGet(printed, count => count + 1)
          yield* Deferred.succeed(firstPrintStarted, undefined)
          yield* Deferred.await(release)
          return JSON.stringify([{ alias: `SYNTHETIC_${generation}` }])
        })
      })
      yield* withCatalog(fixture, catalog =>
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(catalog.list(null), { startImmediately: true })
          const second = yield* Effect.forkChild(catalog.list(null), { startImmediately: true })
          yield* Deferred.await(firstPrintStarted)
          yield* catalog.removeAlias({ alias: 'SYNTHETIC_1', scope: 'global', cwd: null })
          const afterWrite = yield* Effect.forkChild(catalog.list(null), { startImmediately: true })
          yield* Deferred.succeed(release, undefined)
          expect((yield* Fiber.join(first))[0]?.alias).toBe('SYNTHETIC_1')
          expect((yield* Fiber.join(second))[0]?.alias).toBe('SYNTHETIC_1')
          expect((yield* Fiber.join(afterWrite))[0]?.alias).toBe('SYNTHETIC_2')
          expect(yield* catalog.list(null)).toHaveLength(1)
          expect(yield* Ref.get(printed)).toBe(3)
        }),
      )
    }),
  )

  it.effect('cancels one list caller without cancelling another shared read', () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      const cliInterrupted = yield* Ref.make(false)
      const fixture = catalogWithCli(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as('[]'),
          Effect.onInterrupt(() => Ref.set(cliInterrupted, true)),
        ),
      )
      yield* withCatalog(fixture, catalog =>
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(catalog.list('/tmp/demo'), { startImmediately: true })
          const second = yield* Effect.forkChild(catalog.list('/tmp/demo'), { startImmediately: true })
          yield* Deferred.await(started)
          yield* Fiber.interrupt(first)
          expect(Exit.hasInterrupts(yield* Fiber.await(first))).toBe(true)
          expect(yield* Ref.get(cliInterrupted)).toBe(false)
          yield* Deferred.succeed(release, undefined)
          expect(yield* Fiber.join(second)).toEqual([])
          expect(fixture.requests).toHaveLength(1)
        }),
      )
    }),
  )

  it.effect('interrupts and evicts a shared list after its last caller cancels', () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const cliInterrupted = yield* Ref.make(false)
      const calls = yield* Ref.make(0)
      const fixture = catalogWithCli(() =>
        Effect.gen(function* () {
          if ((yield* Ref.updateAndGet(calls, count => count + 1)) > 1) return '[]'
          yield* Deferred.succeed(started, undefined)
          return yield* Effect.never
        }).pipe(Effect.onInterrupt(() => Ref.set(cliInterrupted, true))),
      )
      yield* withCatalog(fixture, catalog =>
        Effect.gen(function* () {
          const pending = yield* Effect.forkChild(catalog.list('/tmp/demo'), { startImmediately: true })
          yield* Deferred.await(started)
          yield* Fiber.interrupt(pending)
          expect(yield* Ref.get(cliInterrupted)).toBe(true)
          expect(yield* catalog.list('/tmp/demo')).toEqual([])
          expect(yield* Ref.get(calls)).toBe(2)
        }),
      )
    }),
  )

  it.effect('refuses metadata a CLI would read as another flag, before running anything', () => {
    const fixture = answering('[]')
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        const created = yield* Effect.flip(
          catalog.create({ alias: 'SYNTHETIC', scope: 'global', cwd: null, environment: 'prod', valueMode: 'generate', value: null, name: '--global' }),
        )
        const updated = yield* Effect.flip(catalog.update({ alias: 'SYNTHETIC', scope: 'global', cwd: null, environment: 'prod', value: null, tags: '-f' }))
        expect(created).toMatchObject({ _tag: 'SecretCatalogOperationError', reason: 'invalid-argument' })
        expect(updated).toMatchObject({ _tag: 'SecretCatalogOperationError', reason: 'invalid-argument' })
        expect(fixture.requests.filter(request => request.args[0] !== 'print')).toEqual([])
      }),
    )
  })

  it.effect('runs reveal and clipboard copy only when exact alias methods are called', () => {
    const fixture = catalogWithCli(request => Effect.succeed(request.args[0] === 'get' ? 'synthetic-value\n' : ''))
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        expect(fixture.requests).toEqual([])
        expect(yield* catalog.reveal({ alias: 'SYNTHETIC_TOKEN', scope: 'global', cwd: null })).toBe('synthetic-value')
        expect(fixture.requests.at(-1)).toEqual({ args: ['get', 'SYNTHETIC_TOKEN', '--config', globalConfig], cwd: null, captureStdout: true })
        expect(yield* catalog.copy({ alias: 'SYNTHETIC_TOKEN', scope: 'global', cwd: null })).toEqual({ copied: true })
        expect(fixture.requests.at(-1)).toEqual({ args: ['get', 'SYNTHETIC_TOKEN', '--config', globalConfig, '--copy'], cwd: null, captureStdout: false })
      }),
    )
  })

  it.effect('targets a local alias file and environment for deliberate value actions', () => {
    const fixture = answering('synthetic-value')
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        yield* catalog.reveal({ alias: 'SYNTHETIC_TOKEN', scope: 'local', cwd: '/tmp/project', environment: 'dev' })
        expect(fixture.requests.at(-1)).toEqual({
          args: ['get', 'SYNTHETIC_TOKEN', '--env', 'dev', '--config', '/tmp/project/.secret.local.json'],
          cwd: '/tmp/project',
          captureStdout: true,
        })
      }),
    )
  })

  it.effect('adds generated aliases using the selected scope and exact CLI flags', () => {
    const fixture = answering('[]')
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        yield* catalog.create({
          alias: 'SYNTHETIC_NEW',
          scope: 'project',
          cwd: '/tmp/project',
          environment: 'prod',
          valueMode: 'generate',
          value: null,
          name: 'Synthetic item',
        })
        expect(fixture.requests).toEqual([
          { args: ['print', '--all', '--json'], cwd: '/tmp/project', captureStdout: true },
          { args: ['set', 'SYNTHETIC_NEW', '--env', 'prod', '--name', 'Synthetic item', '--generate'], cwd: '/tmp/project', captureStdout: false },
        ])
      }),
    )
  })

  it.effect('adds global aliases in the requested environment without a project folder', () => {
    const fixture = answering('[]')
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        yield* catalog.create({ alias: 'SYNTHETIC_GLOBAL', scope: 'global', cwd: null, environment: 'staging', valueMode: 'generate', value: null })
        expect(fixture.requests).toEqual([
          { args: ['print', 'global', '--json'], cwd: null, captureStdout: true },
          { args: ['set', 'SYNTHETIC_GLOBAL', '--env', 'staging', '--global', '--generate'], cwd: null, captureStdout: false },
        ])
      }),
    )
  })

  it.effect('adds manual local aliases over stdin without putting their values in argv or output', () => {
    const fixture = answering('[]')
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        yield* catalog.create({
          alias: 'SYNTHETIC_LOCAL',
          scope: 'local',
          cwd: '/tmp/project',
          environment: 'prod',
          valueMode: 'manual',
          value: 'synthetic-input-value',
        })
        expect(fixture.requests).toEqual([
          { args: ['print', '--all', '--json'], cwd: '/tmp/project', captureStdout: true },
          {
            args: ['set', 'SYNTHETIC_LOCAL', '--env', 'prod', '--config', '/tmp/project/.secret.local.json'],
            cwd: '/tmp/project',
            captureStdout: false,
            stdin: 'synthetic-input-value',
          },
        ])
        expect(fixture.requests.flatMap(request => request.args)).not.toContain('synthetic-input-value')
      }),
    )
  })

  it.effect('tags missing manual values and unchanged updates as domain failures', () => {
    const fixture = answering('')
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        const missingValue = yield* Effect.flip(
          catalog.create({ alias: 'SYNTHETIC_MISSING_VALUE', scope: 'project', cwd: '/tmp/project', environment: 'prod', valueMode: 'manual', value: null }),
        )
        const unchanged = yield* Effect.flip(catalog.update({ alias: 'SYNTHETIC_UNCHANGED', scope: 'global', cwd: null, environment: 'prod', value: null }))
        expect(missingValue).toMatchObject({ _tag: 'SecretCatalogOperationError', message: 'A non-empty value is required for a manual secret.' })
        expect(unchanged).toMatchObject({ _tag: 'SecretCatalogOperationError', message: 'No secret changes were provided.' })
        expect(fixture.requests).toEqual([])
      }),
    )
  })

  it.effect('refuses to add an alias already present in the current environment', () => {
    const fixture = answering(JSON.stringify([{ alias: 'SYNTHETIC_EXISTING', scope: 'global', env: 'prod' }]))
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          catalog.create({ alias: 'SYNTHETIC_EXISTING', scope: 'project', cwd: '/tmp/project', environment: 'prod', valueMode: 'generate', value: null }),
        )
        expect(error).toMatchObject({ _tag: 'SecretCatalogOperationError', message: 'An alias with this name already exists in the current environment.' })
        expect(fixture.requests).toHaveLength(1)
      }),
    )
  })

  it.effect('adds the same alias in a different explicitly selected environment', () => {
    const fixture = answering(JSON.stringify([{ alias: 'SYNTHETIC_ENV_ALIAS', scope: 'project', env: 'dev' }]))
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        yield* catalog.create({ alias: 'SYNTHETIC_ENV_ALIAS', scope: 'project', cwd: '/tmp/project', environment: 'prod', valueMode: 'generate', value: null })
        expect(fixture.requests[1]).toEqual({ args: ['set', 'SYNTHETIC_ENV_ALIAS', '--env', 'prod', '--generate'], cwd: '/tmp/project', captureStdout: false })
      }),
    )
  })

  it.effect('edits metadata and replaces values only through explicit operation calls', () => {
    const fixture = answering('')
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        expect(fixture.requests).toEqual([])
        yield* catalog.update({
          alias: 'SYNTHETIC_EXISTING',
          scope: 'local',
          cwd: '/tmp/project',
          environment: 'dev',
          value: 'synthetic-replacement',
          name: 'Renamed item',
          tags: '',
        })
        expect(fixture.requests).toEqual([
          {
            args: ['edit', 'SYNTHETIC_EXISTING', '--name', 'Renamed item', '--tags', '', '--env', 'dev', '--config', '/tmp/project/.secret.local.json'],
            cwd: '/tmp/project',
            captureStdout: false,
          },
          {
            args: ['set', 'SYNTHETIC_EXISTING', '--force', '--env', 'dev', '--config', '/tmp/project/.secret.local.json'],
            cwd: '/tmp/project',
            captureStdout: false,
            stdin: 'synthetic-replacement',
          },
        ])
        expect(fixture.requests.flatMap(request => request.args)).not.toContain('synthetic-replacement')
      }),
    )
  })

  it.effect('renames an alias in its own config before editing it under the new name', () => {
    const fixture = catalogWithCli(request => Effect.succeed(request.args[0] === 'print' ? JSON.stringify([{ alias: 'SYNTHETIC_OLD' }]) : ''))
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        yield* catalog.update({
          alias: 'SYNTHETIC_OLD',
          newAlias: 'SYNTHETIC_NEW',
          scope: 'global',
          cwd: null,
          environment: 'prod',
          value: null,
          source: 'https://example.test',
        })
        expect(fixture.requests.map(request => request.args)).toEqual([
          ['print', 'global', '--json'],
          ['mv', 'SYNTHETIC_OLD', 'SYNTHETIC_NEW', '--global'],
          ['edit', 'SYNTHETIC_NEW', '--source', 'https://example.test', '--env', 'prod', '--config', globalConfig],
        ])
      }),
    )
  })

  it.effect('refuses a rename onto an alias that already exists', () => {
    const fixture = answering(JSON.stringify([{ alias: 'SYNTHETIC_OLD' }, { alias: 'SYNTHETIC_TAKEN' }]))
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          catalog.update({ alias: 'SYNTHETIC_OLD', newAlias: 'SYNTHETIC_TAKEN', scope: 'global', cwd: null, environment: 'prod', value: null }),
        )
        expect(error).toMatchObject({ _tag: 'SecretCatalogOperationError', message: 'An alias with this name already exists.' })
        expect(fixture.requests).toHaveLength(1)
      }),
    )
  })

  it.effect('keeps project alias removal distinct from global item deletion', () => {
    const fixture = answering('')
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        yield* catalog.removeAlias({ alias: 'SYNTHETIC_EXISTING', scope: 'project', cwd: '/tmp/project' })
        expect(fixture.requests.at(-1)).toEqual({ args: ['unset', 'SYNTHETIC_EXISTING'], cwd: '/tmp/project', captureStdout: false })
        yield* catalog.deleteItem({ alias: 'SYNTHETIC_EXISTING', scope: 'global', cwd: null, environment: 'prod' })
        expect(fixture.requests.at(-1)).toEqual({
          args: ['rm', 'SYNTHETIC_EXISTING', '--force', '--env', 'prod', '--config', globalConfig],
          cwd: null,
          captureStdout: false,
        })
      }),
    )
  })

  it.effect('rejects unsupported aliases, invalid environments, and relative paths before invoking the CLI', () => {
    const fixture = answering('')
    return withCatalog(fixture, catalog =>
      Effect.gen(function* () {
        expect(yield* Effect.flip(catalog.reveal({ alias: '1NOT_VALID', scope: 'project', cwd: '/tmp/project' }))).toMatchObject({ reason: 'invalid-argument' })
        expect(yield* Effect.flip(catalog.copy({ alias: 'SYNTHETIC', scope: 'local', cwd: 'relative/path' }))).toMatchObject({
          message: 'A canonical absolute folder path is required.',
        })
        expect(yield* Effect.flip(catalog.reveal({ alias: 'SYNTHETIC', scope: 'project', cwd: '/tmp/project', environment: '../prod' }))).toMatchObject({
          reason: 'invalid-argument',
        })
        expect(fixture.requests).toEqual([])
      }),
    )
  })
})

describe('Secret Catalog workspace picker ports', () => {
  it('routes picker browsing and workspace registration through the Host Remote contracts', async () => {
    const calls: string[] = []
    const remote: WorkspacePickerRemote = {
      directoryPicker: {
        pick: async () => {
          calls.push('pick')
          return { ok: true, value: '/work/repo' }
        },
        list: async path => {
          calls.push(`list:${path ?? ''}`)
          return { ok: true, value: { path: path ?? '/work', home: '/home/me', crumbs: [], entries: [], truncated: false } }
        },
        createDirectory: async (path, name) => {
          calls.push(`mkdir:${path}/${name}`)
          return { ok: true, value: `${path}/${name}` }
        },
      },
      workspace: {
        create: async input => {
          calls.push(`workspace:${input.path}`)
          return { ok: true, value: { workspace: { workspaceId: 'workspace-7', path: input.path, title: 'repo' }, created: true } }
        },
      },
    }
    const ports = createWorkspacePickerPorts(remote)
    expect(await ports.directoryPicker.pick(new AbortController().signal)).toBe('/work/repo')
    expect((await ports.directoryPicker.list('/work/repo', new AbortController().signal)).path).toBe('/work/repo')
    expect(await ports.directoryPicker.createDirectory('/work/repo', 'new')).toBe('/work/repo/new')
    expect(await ports.registerWorkspace('/work/repo')).toEqual({ workspaceId: 'workspace-7', title: 'repo', canonicalPath: '/work/repo' })
    expect(calls).toEqual(['pick', 'list:/work/repo', 'mkdir:/work/repo/new', 'workspace:/work/repo'])
  })

  it('surfaces Host capability refusal instead of inventing a local picker result', async () => {
    const remote: WorkspacePickerRemote = {
      directoryPicker: {
        pick: async () => ({ ok: false, error: 'unsupported' }),
        list: async () => ({ ok: false, error: 'unsupported' }),
        createDirectory: async () => ({ ok: false, error: 'unsupported' }),
      },
      workspace: { create: async () => ({ ok: false, error: 'unsupported' }) },
    }
    const ports = createWorkspacePickerPorts(remote)
    await expect(ports.directoryPicker.pick(new AbortController().signal)).rejects.toThrow('Folder picking is unavailable.')
    await expect(ports.directoryPicker.list(undefined, new AbortController().signal)).rejects.toThrow('Folder browsing is unavailable.')
    await expect(ports.directoryPicker.createDirectory('/tmp/project', 'new')).rejects.toThrow('Folder creation is unavailable.')
    await expect(ports.registerWorkspace('/tmp/project')).rejects.toThrow('Workspace registration was refused.')
  })
})
