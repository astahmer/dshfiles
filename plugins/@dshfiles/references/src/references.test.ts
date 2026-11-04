import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import referencesHost from './host.js'
import { References, type Reference } from './references.js'

const reference = (name: string, path = `/refs/${name}`): Reference => ({
  name,
  kind: 'directory',
  source: path,
  ref: null,
  path,
  description: null,
  createdAt: 1,
})

const wireEnvelope = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: Schema.Unknown }) }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ]),
})

const savedReference = Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: References.referenceSchema }) })
const referenceList = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Struct({ output: Schema.Struct({ references: Schema.Array(References.referenceSchema), attached: Schema.Array(Schema.String) }) }),
})

type ApiInput = Parameters<TestHost['connection']['requestApi']>[0]['input']

/** The plugin in a real test Host: JSON storage, the native subprocess runtime, and DSH_HOME in a temporary directory. */
const mountedReferences = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'references-')))),
    directory => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  )
  const previousHome = process.env.DSH_HOME
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.DSH_HOME = join(root, 'home')
    }),
    () =>
      Effect.sync(() => {
        if (previousHome === undefined) delete process.env.DSH_HOME
        else process.env.DSH_HOME = previousHome
      }),
  )
  const host = yield* Effect.acquireRelease(
    Effect.promise(async () => {
      const created = await createTestHost()
      await created.ctx.plugin(LocalSubprocessRuntime)
      await created.ctx.plugin(Storage)
      await created.ctx.plugin(StorageJson, { root: join(root, 'storage') })
      await created.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
      const plugin = await created.mount(referencesHost, { packageId: '@dshfiles/references' })
      return { created, plugin }
    }),
    mounted => Effect.promise(() => mounted.created.dispose()),
  )
  const call = (method: string, input: ApiInput) =>
    Effect.promise(async () => {
      const response = await host.created.connection.requestApi({ packageId: '@dshfiles/references', apiId: 'references', method, version: 1, input })
      return Schema.decodeUnknownSync(wireEnvelope)(await response.json()).result
    })
  const listed = (sessionId?: string) => Effect.map(call('list', sessionId === undefined ? {} : { sessionId }), Schema.decodeUnknownSync(referenceList))
  return { root, host: host.created, plugin: host.plugin, call, listed }
})

describe('References', () => {
  it('tells a git URL from a directory and refuses a relative path', () => {
    expect(References.kindOf('https://github.com/anomalyco/opencode.git')).toBe('git')
    expect(References.kindOf('git@github.com:anomalyco/opencode.git')).toBe('git')
    expect(References.kindOf('file:///srv/repo')).toBe('git')
    expect(References.kindOf('/Users/me/docs')).toBe('directory')
    expect(References.kindOf('~/docs')).toBe('directory')
    expect(References.kindOf('docs')).toBeUndefined()
  })

  it.effect('attaches per Session, keeps the order, and detaches everywhere when a reference is removed', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, call, listed } = yield* mountedReferences
        yield* call('save', { name: 'docs', source: root })
        yield* call('save', { name: 'api', source: root })
        yield* call('attach', { name: 'docs', sessionId: 'session-a' })
        yield* call('attach', { name: 'api', sessionId: 'session-a' })
        yield* call('attach', { name: 'docs', sessionId: 'session-a' })
        yield* call('attach', { name: 'docs', sessionId: 'session-b' })

        expect((yield* listed('session-a')).value.output.attached).toEqual(['docs', 'api'])
        expect((yield* listed('session-c')).value.output.attached).toEqual([])

        expect(yield* call('remove', { name: 'docs', confirm: true })).toEqual({ ok: true, value: { output: { removed: true } } })
        expect((yield* listed('session-a')).value.output.attached).toEqual(['api'])
        expect((yield* listed('session-b')).value.output.attached).toEqual([])
        expect(yield* call('detach', { name: 'docs', sessionId: 'session-a' })).toEqual({ ok: true, value: { output: { attached: ['api'] } } })
        expect(yield* call('detach', { name: 'api', sessionId: 'session-a' })).toEqual({ ok: true, value: { output: { attached: [] } } })
        expect((yield* listed()).value.output.references.map(entry => entry.name)).toEqual(['api'])

        expect(yield* call('attach', { name: 'missing', sessionId: 'session-a' })).toEqual({
          ok: false,
          error: { code: 'unknown-reference', message: 'No reference is named missing; save it first or list the saved ones.' },
        })
        expect(yield* call('attach', { name: 'api' })).toEqual({
          ok: false,
          error: { code: 'no-session', message: 'Pass the sessionId to attach to; only an agent call defaults to its own Session.' },
        })
      }),
    ),
  )

  it('names each attached reference with its path and origin, and nothing when none is attached', () => {
    expect(References.promptText([])).toBe('')
    const text = References.promptText([
      reference('docs'),
      {
        ...reference('opencode', '/home/.dsh/references/opencode'),
        kind: 'git',
        source: 'https://github.com/anomalyco/opencode',
        ref: 'dev',
        description: 'v2 source',
      },
    ])
    expect(text).toContain('- docs: /refs/docs')
    expect(text).toContain('- opencode: /home/.dsh/references/opencode (clone of https://github.com/anomalyco/opencode at dev) — v2 source')
    expect(text).toContain('never edit them')
  })

  it.effect('keeps references and attachments across a reload and lists them from the /reference command', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, host, plugin, call, listed } = yield* mountedReferences
        yield* call('save', { name: 'docs', source: root, description: 'local docs' })
        const command = host.commands.get('reference')
        if (command === undefined) return expect.fail('the plugin registers /reference')
        // SAFETY: the handler reads only rawInput and agent.id; a full CommandInvocation needs a live Agent.
        const invoke = (rawInput: string) => Effect.promise(() => command.handler({ rawInput, agent: { id: 'session-a' } } as never))
        expect(yield* invoke('attach docs')).toEqual({ kind: 'success', text: 'Attached docs. Attached now: docs.' })
        expect(yield* invoke('attach nothing')).toEqual({
          kind: 'error',
          text: 'No reference is named nothing. Usage: /reference · /reference attach <name> · /reference detach <name> · /reference save <name> <directory-or-git-url> [ref]',
        })
        yield* Effect.promise(() => plugin.reload())
        expect((yield* listed('session-a')).value.output.attached).toEqual(['docs'])
        const reloaded = host.commands.get('reference')
        if (reloaded === undefined) return expect.fail('the reloaded plugin registers /reference again')
        // SAFETY: as above, the handler reads only rawInput and agent.id.
        expect(yield* Effect.promise(() => reloaded.handler({ rawInput: '', agent: { id: 'session-a' } } as never))).toEqual({
          kind: 'success',
          text: `● docs · ${root}`,
        })
      }),
    ),
  )
})

describe('References.prepare against real git and folders', () => {
  it.effect('reads a directory in place and refuses one that does not exist', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, call } = yield* mountedReferences
        const prepared = Schema.decodeUnknownSync(savedReference)(yield* call('save', { name: 'docs', source: root }))
        expect(prepared.value.output).toMatchObject({ kind: 'directory', path: root, ref: null })
        expect(existsSync(join(root, 'home', 'references'))).toBe(false)
        expect(yield* call('save', { name: 'docs', source: join(root, 'missing') })).toEqual({
          ok: false,
          error: { code: 'not-a-directory', message: `${join(root, 'missing')} is not a directory on this Host.` },
        })
        expect(yield* call('save', { name: 'docs', source: root, ref: 'main' })).toEqual({
          ok: false,
          error: { code: 'invalid-source', message: 'Only a git reference takes a ref.' },
        })
        expect(yield* call('save', { name: 'docs', source: 'docs' })).toMatchObject({ ok: false, error: { code: 'invalid-source' } })
      }),
    ),
  )

  it.effect('shallow-clones a git URL at a ref into the clones directory, replacing an earlier clone', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, call } = yield* mountedReferences
        using recorder = recordSpans()
        const origin = join(root, 'origin')
        execFileSync('git', ['init', '-q', '-b', 'main', origin])
        writeFileSync(join(origin, 'README.md'), 'v1\n')
        execFileSync('git', ['-C', origin, 'add', '.'])
        execFileSync('git', ['-C', origin, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'v1'])
        execFileSync('git', ['-C', origin, 'branch', 'release'])

        const clones = join(root, 'home', 'references')
        const prepared = Schema.decodeUnknownSync(savedReference)(yield* call('save', { name: 'origin', source: `file://${origin}`, ref: 'release' }))
        expect(prepared.value.output).toMatchObject({ kind: 'git', ref: 'release', path: join(clones, 'origin') })
        expect(readFileSync(join(clones, 'origin', 'README.md'), 'utf8')).toBe('v1\n')
        expect(recorder.span('git clone').status.code).not.toBe('error')

        const failed = yield* call('save', { name: 'origin', source: `file://${origin}`, ref: 'missing' })
        expect(failed).toMatchObject({ ok: false, error: { code: 'clone-failed' } })
        expect(failed.ok ? '' : failed.error.message).toMatch(/^git clone failed: /u)
      }),
    ),
  )
})
