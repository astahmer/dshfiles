import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Jj } from '@dshfiles/jj-cli'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { AutoFetchModel } from './auto-fetch.js'
import { defaultJjIntegrationSettings } from './settings.js'

const jjAvailable = spawnSync('jj', ['--version']).status === 0
const env = { ...process.env, JJ_CONFIG: '', JJ_USER: 'Test', JJ_EMAIL: 'test@example.com' }

const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env })

const commitAt = (cwd: string, revset: string): string => jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', 'commit_id').trim()

const advanceOrigin = (origin: string, content: string): void => {
  writeFileSync(join(origin, 'file.txt'), content)
  jj(origin, 'commit', '-m', content)
  jj(origin, 'bookmark', 'set', 'main', '-r', '@-')
}

/** An origin with one commit and a clone of it, removed when the test's scope closes. */
const repositories = Effect.acquireRelease(
  Effect.sync(() => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-auto-fetch-')))
    const origin = join(root, 'origin')
    const clone = join(root, 'clone')
    execFileSync('jj', ['git', 'init', '--colocate', origin], { stdio: 'ignore', env })
    advanceOrigin(origin, 'one')
    execFileSync('jj', ['git', 'clone', origin, clone], { stdio: 'ignore', env })
    return { root, origin, clone }
  }),
  created => Effect.sync(() => rmSync(created.root, { recursive: true, force: true })),
)

const fetch = (input: { readonly clone: string; readonly fastForward: boolean; readonly remote?: string }) =>
  AutoFetchModel.fetchRepository({ repoRoot: input.clone, remote: input.remote ?? 'origin', bookmark: 'main', fastForward: input.fastForward })

describe('auto fetch settings', () => {
  it('is off by default and fetches origin every 30 minutes without moving the bookmark', () => {
    expect(defaultJjIntegrationSettings.autoFetch).toEqual({ enabled: false, intervalMinutes: 30, remote: 'origin', fastForwardBookmark: false })
  })
})

describe.skipIf(!jjAvailable)('auto fetch against real jj', () => {
  it.layer(Layer.provideMerge(Jj.layer, NodeServices.layer), { timeout: 120_000 })(it => {
    it.effect('skips a repository without the configured remote', () =>
      Effect.gen(function* () {
        const { clone } = yield* repositories
        expect(yield* fetch({ clone, fastForward: false, remote: 'upstream' })).toEqual({ status: 'no-remote', repoRoot: clone })
      }).pipe(Effect.scoped),
    )

    it.effect('refreshes main@origin and reports when a tracked bookmark followed it', () =>
      Effect.gen(function* () {
        const { origin, clone } = yield* repositories
        advanceOrigin(origin, 'two')
        expect(yield* fetch({ clone, fastForward: false })).toEqual({ status: 'fetched', repoRoot: clone, bookmarkMoved: true })
        expect(commitAt(clone, 'main@origin')).toBe(commitAt(origin, 'main'))
      }).pipe(Effect.scoped),
    )

    it.effect('fast-forwards an untracked local bookmark only when opted in', () =>
      Effect.gen(function* () {
        const { origin, clone } = yield* repositories
        jj(clone, 'bookmark', 'untrack', 'main@origin')
        const before = commitAt(clone, 'main')
        advanceOrigin(origin, 'two')
        expect(yield* fetch({ clone, fastForward: false })).toEqual({ status: 'fetched', repoRoot: clone, bookmarkMoved: false })
        expect(commitAt(clone, 'main')).toBe(before)
        expect(yield* fetch({ clone, fastForward: true })).toEqual({ status: 'fast-forwarded', repoRoot: clone, from: before, to: commitAt(origin, 'main') })
        expect(commitAt(clone, 'main')).toBe(commitAt(origin, 'main'))
      }).pipe(Effect.scoped),
    )

    it.effect('never moves a bookmark that holds local commits', () =>
      Effect.gen(function* () {
        const { origin, clone } = yield* repositories
        jj(clone, 'bookmark', 'untrack', 'main@origin')
        jj(clone, 'new', 'main', '-m', 'local work')
        jj(clone, 'bookmark', 'set', 'main', '-r', '@')
        const local = commitAt(clone, 'main')
        advanceOrigin(origin, 'two')
        expect(yield* fetch({ clone, fastForward: true })).toEqual({ status: 'fetched', repoRoot: clone, bookmarkMoved: false })
        expect(commitAt(clone, 'main')).toBe(local)
      }).pipe(Effect.scoped),
    )

    it.effect('reports a failed fetch with a recovery hint and an error span', () =>
      Effect.gen(function* () {
        using recorder = recordSpans()
        const { origin, clone } = yield* repositories
        rmSync(origin, { recursive: true, force: true })
        const outcome = yield* fetch({ clone, fastForward: false }).pipe(Effect.provide(DshxEffect.tracerLayer))
        expect(outcome.status).toBe('failed')
        if (outcome.status !== 'failed') return
        expect(outcome.step).toBe('fetch')
        expect(AutoFetchModel.failureDetail(outcome, 'origin')).toContain('jj git fetch --remote origin')
        const span = recorder.span('jj-integration auto fetch')
        expect(span.attributes['dshx.fetch.status']).toBe('failed')
        expect(span.status.code).toBe('error')
      }).pipe(Effect.scoped),
    )
  })
})
