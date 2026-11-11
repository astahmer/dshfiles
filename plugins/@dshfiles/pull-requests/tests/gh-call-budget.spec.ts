import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { HostContext } from '@dshfiles/dshx/effect/host-context'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { createTestHost } from '@dshfiles/dshx/testing'
import { layer as nodeChildProcessSpawnerLayer } from '@effect/platform-node/NodeChildProcessSpawner'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ForgePullRequests } from '../src/forge-port.js'
import { GitHubCli } from '../src/github-cli.js'
import { GitLabCli } from '../src/gitlab-cli.js'
import { PullRequestMonitor } from '../src/monitor.js'
import type { PullRequestRecord } from '../src/pull-request-model.js'
import { PullRequestStore } from '../src/store.js'

/**
 * A stand-in for `gh` that answers `gh pr view` and aliased `gh api graphql` reads, logs one line per process and the
 * GraphQL points GitHub would charge: the requests each connection needs, summed, divided by 100, at least 1
 * (https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api). A `gh pr view` is one
 * query, so one point. The state file sets each pull request's state, the remaining budget, and failing numbers.
 */
const fakeGh = (input: { readonly log: string; readonly state: string }) => `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const state = JSON.parse(fs.readFileSync(${JSON.stringify(input.state)}, 'utf8'))
const stateOf = number => state.states[String(number)] ?? 'OPEN'
const view = number => ({ state: stateOf(number), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null, statusCheckRollup: [{ name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' }], comments: [], reviews: [], body: '' })
const log = entry => fs.appendFileSync(${JSON.stringify(input.log)}, JSON.stringify(entry) + '\\n')
if (state.limited) { log({ kind: 'limited', points: 0 }); process.stderr.write('gh: API rate limit exceeded for user\\n'); process.exit(1) }
if (args[0] === 'pr' && args[1] === 'view') { log({ kind: 'pr-view', points: 1 }); process.stdout.write(JSON.stringify(view(Number(args[2])))); process.exit(0) }
if (args[0] === 'api' && args[1] === 'graphql') {
  const query = args.find(arg => arg.startsWith('query=')).slice(6)
  const aliases = [...query.matchAll(/(p\\d+):repository\\(owner:"[^"]+",name:"[^"]+"\\)\\{pullRequest\\(number:(\\d+)\\)/g)]
  const connections = (query.match(/\\((?:first|last):\\d+\\)/g) ?? []).length
  const points = Math.max(1, Math.round(connections / 100))
  const full = query.includes('comments(')
  const data = { rateLimit: { cost: points, remaining: state.remaining ?? 4900, resetAt: state.resetAt ?? '2099-01-01T00:00:00Z' } }
  const errors = []
  for (const [, alias, number] of aliases) {
    if ((state.missing ?? []).includes(Number(number))) { data[alias] = { pullRequest: null }; errors.push({ type: 'NOT_FOUND', path: [alias, 'pullRequest'] }); continue }
    const node = { state: stateOf(number), updatedAt: '2026-11-11T10:00:00Z', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null,
      commits: { nodes: [{ commit: { oid: 'abc', statusCheckRollup: { state: 'SUCCESS', contexts: { checkRunCountsByState: [{ state: 'SUCCESS', count: 1 }], statusContextCountsByState: [], ...(full ? { nodes: [{ __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' }] } : {}) } } } }] } }
    if (full) Object.assign(node, { body: '', comments: { totalCount: 0, nodes: [] }, reviews: { totalCount: 0, nodes: [] } })
    data[alias] = { pullRequest: node }
  }
  log({ kind: full ? 'graphql-full' : 'graphql-cheap', points, aliases: aliases.length })
  process.stdout.write(JSON.stringify(errors.length > 0 ? { data, errors } : { data }))
  process.exit(errors.length > 0 ? 1 : 0)
}
log({ kind: 'other', points: 0, args }); process.exit(1)
`

let root = ''
let log = ''
let statePath = ''
const savedPath = process.env['PATH']

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pull-requests-budget-'))
  const bin = join(root, 'bin')
  log = join(root, 'gh.log')
  statePath = join(root, 'state.json')
  await mkdir(bin)
  await writeFile(join(bin, 'gh'), fakeGh({ log, state: statePath }))
  await chmod(join(bin, 'gh'), 0o755)
  process.env['PATH'] = `${bin}:${savedPath ?? ''}`
})

afterAll(async () => {
  process.env['PATH'] = savedPath
  await rm(root, { recursive: true, force: true })
})

interface GhCall {
  readonly kind: string
  readonly points: number
  readonly aliases?: number
}

const setState = (state: {
  readonly states?: Record<string, string>
  readonly remaining?: number
  readonly resetAt?: string
  readonly limited?: boolean
  readonly missing?: readonly number[]
}) => writeFile(statePath, JSON.stringify({ states: {}, ...state }))

const readCalls = async (): Promise<readonly GhCall[]> => {
  const text = await readFile(log, 'utf8').catch(() => '')
  await writeFile(log, '')
  return text
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as GhCall)
}

const link = (number: number): PullRequestRecord => ({
  id: `session-${String(number)}::acme/widget#${String(number)}`,
  sessionId: `session-${String(number)}`,
  repo: 'acme/widget',
  number,
  url: `https://github.com/acme/widget/pull/${String(number)}`,
  cwd: '',
  watching: true,
  lastKnownState: null,
  lastCheckedAt: null,
  retryAfterAt: null,
  consecutiveRateLimits: 0,
  lastError: null,
})

const spawner = nodeChildProcessSpawnerLayer.pipe(Layer.provideMerge(Layer.mergeAll(nodeFileSystemLayer, nodePathLayer)))
const forge = ForgePullRequests.layer.pipe(Layer.provide(Layer.mergeAll(GitHubCli.layer, GitLabCli.layer).pipe(Layer.provide(spawner))))

const withMonitor = <A, E>(use: Effect.Effect<A, E, PullRequestMonitor | PullRequestStore>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const storageRoot = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'pull-requests-budget-store-')))
        const host = yield* Effect.acquireRelease(
          Effect.promise(async () => {
            const mounted = await createTestHost()
            await mounted.ctx.plugin(Storage)
            await mounted.ctx.plugin(StorageJson, { root: storageRoot })
            await mounted.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
            return mounted
          }),
          mounted => Effect.promise(() => mounted.dispose()),
        )
        const hostContext = HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/pull-requests' })
        const layer = PullRequestMonitor.layer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(PullRequestStore.layer, forge).pipe(
              Layer.provideMerge(Layer.mergeAll(StorageDomain.layer, HostApis.layer).pipe(Layer.provide(Layer.succeed(HostContext, hostContext)))),
            ),
          ),
        )
        return yield* use.pipe(Effect.provide(layer), Effect.ensuring(Effect.promise(() => rm(storageRoot, { recursive: true, force: true }))))
      }),
    ),
  )

const seed = (count: number) =>
  Effect.gen(function* () {
    const store = yield* PullRequestStore
    for (let number = 1; number <= count; number += 1) yield* store.upsert(link(number))
  })

const sweep = Effect.flatMap(PullRequestMonitor, monitor => monitor.pollAll)

const totals = (calls: readonly GhCall[]) => ({ spawns: calls.length, points: calls.reduce((sum, call) => sum + call.points, 0) })

describe('gh calls per sweep', () => {
  it.each([5, 50, 300])(
    'reads %i watched pull requests in one GraphQL call per fifty, and a quiet second sweep costs one cheap call per fifty',
    async count => {
      await setState({})
      await readCalls()
      const [first, second] = await withMonitor(
        Effect.gen(function* () {
          yield* seed(count)
          yield* sweep
          const firstCalls = yield* Effect.promise(readCalls)
          yield* sweep
          return [firstCalls, yield* Effect.promise(readCalls)] as const
        }),
      )
      const batches = Math.ceil(count / 50)
      console.info(`gh budget ${String(count)} watches: first sweep ${JSON.stringify(totals(first))}, steady sweep ${JSON.stringify(totals(second))}`)
      expect(first.map(call => call.kind)).toEqual(Array.from({ length: batches }, () => 'graphql-full'))
      expect(second.map(call => call.kind)).toEqual(Array.from({ length: batches }, () => 'graphql-cheap'))
      expect(totals(second).points).toBe(batches)
    },
    240_000,
  )

  it('records one gh batch span per GraphQL read with its size and pass', async () => {
    await setState({})
    using recorder = recordSpans()
    await Effect.runPromise(
      GitHubCli.use(github => github.pullRequests({ targets: [{ repo: 'acme/widget', number: 1, known: null }], minRemaining: 0 })).pipe(
        Effect.provide(GitHubCli.layer.pipe(Layer.provide(spawner))),
        Effect.provide(DshxEffect.tracerLayer),
      ),
    )
    await readCalls()
    expect(recorder.span('pull request gh batch').attributes).toMatchObject({
      'dshx.plugin.package': '@dshfiles/pull-requests',
      'github.pull_requests': 1,
      'github.read': 'full',
    })
  })

  it('keeps the pull requests GitHub answered when one alias in the batch is missing', async () => {
    await setState({ missing: [2] })
    await readCalls()
    const stored = await withMonitor(
      Effect.gen(function* () {
        yield* seed(3)
        yield* sweep
        return yield* (yield* PullRequestStore).list()
      }),
    )
    expect((await readCalls()).map(call => call.kind)).toEqual(['graphql-full'])
    expect(stored.map(record => [record.number, record.lastKnownState?.state ?? null, record.lastError])).toEqual([
      [1, 'OPEN', null],
      [2, null, 'gh-command-failed'],
      [3, 'OPEN', null],
    ])
  })

  it('stops polling a merged pull request after the read that saw it merge', async () => {
    await setState({ states: { '1': 'MERGED' } })
    await readCalls()
    const aliases = await withMonitor(
      Effect.gen(function* () {
        yield* seed(2)
        yield* sweep
        yield* Effect.promise(readCalls)
        yield* sweep
        return (yield* Effect.promise(readCalls)).map(call => call.aliases)
      }),
    )
    expect(aliases).toEqual([1])
  })

  it('pauses GitHub reads until the budget resets when the remaining points fall under the floor', async () => {
    await setState({ remaining: 120, resetAt: '2099-01-01T00:00:00Z' })
    await readCalls()
    const calls = await withMonitor(
      Effect.gen(function* () {
        yield* seed(3)
        yield* sweep
        yield* sweep
        return yield* Effect.promise(readCalls)
      }),
    )
    expect(calls.map(call => call.kind)).toEqual(['graphql-full'])
  })

  it('backs off after a rate-limit error instead of reading the next batch', async () => {
    await setState({ limited: true })
    await readCalls()
    const [calls, stored] = await withMonitor(
      Effect.gen(function* () {
        yield* seed(60)
        yield* sweep
        yield* sweep
        return [yield* Effect.promise(readCalls), yield* (yield* PullRequestStore).list()] as const
      }),
    )
    expect(calls).toHaveLength(1)
    expect(stored.every(record => record.retryAfterAt !== null && record.consecutiveRateLimits === 1)).toBe(true)
  }, 30_000)
})
