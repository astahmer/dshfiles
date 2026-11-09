import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { diffsReviewApi } from '../src/api.js'
import plugin from '../src/host.js'

const run = promisify(execFile)
const CONFIG = ['--config', 'user.name=Test', '--config', 'user.email=test@example.com']

const jjAvailable = await run('jj', ['--version']).then(
  () => true,
  () => false,
)

const jj = async (cwd: string, ...args: readonly string[]): Promise<string> => (await run('jj', [...CONFIG, ...args], { cwd })).stdout

const changeIdOf = async (cwd: string, subject: string): Promise<string> =>
  jj(cwd, 'log', '--no-graph', '-r', `subject(substring:${JSON.stringify(subject)})`, '-T', 'change_id')

/** One real jj repository holding a stack `first` → `second` → `third`, the second of which also edits the first's file. */
const fixture = Effect.acquireRelease(
  Effect.promise(async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'diffs-review-revisions-'))
    await jj(workspace, 'git', 'init')
    await writeFile(join(workspace, 'shared.ts'), 'export const first = 1\n')
    await jj(workspace, 'commit', '-m', 'first change')
    await writeFile(join(workspace, 'shared.ts'), 'export const first = 2\n')
    await writeFile(join(workspace, 'second.ts'), 'export const second = true\n')
    await jj(workspace, 'commit', '-m', 'second change')
    await writeFile(join(workspace, 'third.ts'), 'export const third = true\n')
    await jj(workspace, 'commit', '-m', 'third change')
    const ids = {
      first: await changeIdOf(workspace, 'first change'),
      second: await changeIdOf(workspace, 'second change'),
      third: await changeIdOf(workspace, 'third change'),
    }
    const host = await createTestHost()
    await host.ctx.plugin(LocalSubprocessRuntime)
    await host.mount(plugin, { packageId: '@dshfiles/diffs-review', native: false })
    return { host, workspace, ids }
  }),
  f =>
    Effect.promise(async () => {
      await f.host.dispose()
      await rm(f.workspace, { recursive: true, force: true })
    }),
)

const client = (host: Awaited<ReturnType<typeof createTestHost>>) => createHostApiClient(host.ctx, diffsReviewApi, '@dshfiles/diffs-review')

describe.skipIf(!jjAvailable)('combined revision review', () => {
  it.effect('reviews a selection with a gap, oldest first, each revision keeping its own files', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { host, workspace, ids } = yield* fixture
        const result = yield* Effect.promise(() => client(host).reviewRevisions({ path: workspace, revisions: [ids.third, ids.first] }))
        expect(result.status).toBe('ok')
        if (result.status !== 'ok') return
        expect(result.revisions.map(revision => revision.description)).toEqual(['first change', 'third change'])
        expect(result.revisions.map(revision => revision.files.map(file => file.path))).toEqual([['shared.ts'], ['third.ts']])
        expect(result.segments).toBe(2)
        expect(result.unresolved).toEqual([])
        // The graph places the gap: third builds on first with one revision (second) left out, and first sits on root.
        expect(result.graphComplete).toBe(true)
        const [first, third] = result.revisions
        expect(third?.links).toEqual([{ commitId: first?.commitId, hidden: 1 }])
        expect(third?.base).toEqual([])
        expect(first?.links).toEqual([])
        expect(first?.base).toHaveLength(1)
        expect(third).toMatchObject({ workingCopy: false, conflict: false, divergent: false, empty: false, bookmarks: [] })
        const report = yield* Effect.promise(() => client(host).reportRevisions({ path: workspace, revisions: [ids.third, ids.first] }))
        expect(report.text).toContain(`1 revision between ${first?.shortChangeId ?? ''} and ${third?.shortChangeId ?? ''} not in this review`)
      }),
    ),
  )

  it.effect('keeps a file two revisions touched under each of them, and a stack is one run', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { host, workspace, ids } = yield* fixture
        const result = yield* Effect.promise(() => client(host).reviewRevisions({ path: workspace, revisions: [ids.second, ids.first] }))
        if (result.status !== 'ok') throw new Error(result.message)
        expect(result.segments).toBe(1)
        expect(result.revisions[1]?.links).toEqual([{ commitId: result.revisions[0]?.commitId, hidden: 0 }])
        expect(result.revisions[0]?.patch).toContain('+export const first = 1')
        expect(result.revisions[1]?.patch).toContain('-export const first = 1')
        expect(result.fileCount).toBe(3)
      }),
    ),
  )

  it.effect("reads each revision's own patch and jj order out of the batched read", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { host, workspace, ids } = yield* fixture
        const requested = [ids.third, ids.first, ids.second]
        const result = yield* Effect.promise(() => client(host).reviewRevisions({ path: workspace, revisions: requested }))
        if (result.status !== 'ok') throw new Error(result.message)
        const ownPatches = yield* Effect.forEach(result.revisions, revision => Effect.promise(() => jj(workspace, 'diff', '--git', '-r', revision.commitId)))
        expect(result.revisions.map(revision => revision.patch)).toEqual(ownPatches)
        const order = yield* Effect.promise(() =>
          jj(workspace, 'log', '--reversed', '--no-graph', '-r', requested.join(' | '), '-T', 'commit_id.short(64) ++ "\\n"'),
        )
        expect(result.revisions.map(revision => revision.commitId)).toEqual(
          order
            .split('\n')
            .filter(line => line.length > 0)
            .map(line => line.trim()),
        )
      }),
    ),
  )

  it.effect('reviews the rest and names a revision that is gone or divergent', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { host, workspace, ids } = yield* fixture
        yield* Effect.promise(async () => {
          const operation = (await jj(workspace, 'op', 'log', '--no-graph', '-n', '1', '-T', 'id.short()')).trim()
          await jj(workspace, 'describe', '-r', ids.second, '-m', 'second rewritten')
          await jj(workspace, '--at-op', operation, 'describe', '-r', ids.second, '-m', 'second diverged')
        })
        const result = yield* Effect.promise(() =>
          client(host).reviewRevisions({ path: workspace, revisions: [ids.first, ids.second.slice(0, 12), 'kkkkkkkkkkkk'] }),
        )
        if (result.status !== 'ok') throw new Error(result.message)
        expect(result.revisions.map(revision => revision.description)).toEqual(['first change'])
        expect(result.unresolved.map(item => [item.revision, item.reason])).toEqual([
          [ids.second.slice(0, 12), 'divergent'],
          ['kkkkkkkkkkkk', 'missing'],
        ])
        expect(result.unresolved.every(item => item.message.length > 0)).toBe(true)
      }),
    ),
  )

  it.effect('refuses a revset expression before anything reaches jj', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { host, workspace } = yield* fixture
        const error = yield* Effect.flip(Effect.tryPromise(() => client(host).reviewRevisions({ path: workspace, revisions: ['all()'] })))
        expect(error).toBeDefined()
      }),
    ),
  )

  it.effect('gives the agent the same review as text', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { host, workspace, ids } = yield* fixture
        const tool = yield* Effect.promise(() =>
          host.tools.execute({
            callId: ToolCallId('call-revisions'),
            name: 'diffs_review_revisions',
            arguments: { path: workspace, revisions: [ids.first, ids.third] },
            signal: new AbortController().signal,
          }),
        )
        expect(tool).toMatchObject({ isError: false })
        const text = tool.content.map(block => (block.type === 'text' ? block.text : '')).join('\n')
        expect(text).toContain('2 revisions')
        expect(text).toContain('first change')
        expect(text).toContain('third.ts')
        expect(text).toContain('gaps')
      }),
    ),
  )
})
