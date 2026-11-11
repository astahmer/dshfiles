import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { layer as nodeChildProcessSpawnerLayer } from '@effect/platform-node/NodeChildProcessSpawner'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitHubCli } from '../src/github-cli.js'

/**
 * A stand-in for `gh api graphql`: the first alias is a closed issue, the second an open one, and a deleted issue
 * (`acme/gone`) makes gh print the other aliases and exit 1, as the real CLI does. `FAKE_GH_MODE=limited` rate-limits.
 */
const fakeGhScript = (log: string) => `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
if [ "$FAKE_GH_MODE" = "limited" ]; then echo "gh: API rate limit exceeded for user" >&2; exit 1; fi
case "$*" in
  *acme/gone*|*'"gone"'*) echo '{"data":{"i0":{"issueOrPullRequest":{"state":"CLOSED","stateReason":"COMPLETED"}},"i1":{"issueOrPullRequest":null}}}'; echo "gh: Could not resolve to an issue" >&2; exit 1 ;;
  *) echo '{"data":{"i0":{"issueOrPullRequest":{"state":"CLOSED","stateReason":"COMPLETED"}},"i1":{"issueOrPullRequest":{"state":"OPEN","stateReason":null}}}}' ;;
esac
`

let root = ''
let log = ''
const savedPath = process.env['PATH']

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pull-requests-issues-'))
  const bin = join(root, 'bin')
  log = join(root, 'gh.log')
  await mkdir(bin)
  await writeFile(join(bin, 'gh'), fakeGhScript(log))
  await chmod(join(bin, 'gh'), 0o755)
  process.env['PATH'] = `${bin}:${savedPath ?? ''}`
})

afterAll(async () => {
  process.env['PATH'] = savedPath
  delete process.env['FAKE_GH_MODE']
  await rm(root, { recursive: true, force: true })
})

const layer = GitHubCli.layer.pipe(Layer.provide(nodeChildProcessSpawnerLayer.pipe(Layer.provideMerge(Layer.mergeAll(nodeFileSystemLayer, nodePathLayer)))))
const issueStates = (urls: readonly string[]) => Effect.runPromise(GitHubCli.use(github => github.issueStates({ urls })).pipe(Effect.provide(layer)))

describe('GitHub issue states', () => {
  it('reads a batch of issues in one gh call and reports the ones it could not read', async () => {
    delete process.env['FAKE_GH_MODE']
    const read = await issueStates([
      'https://github.com/acme/widget/issues/3',
      'https://github.com/acme/widget/issues/4',
      'https://example.com/acme/x/issues/1',
    ])
    expect(read).toEqual({
      issues: [
        { url: 'https://github.com/acme/widget/issues/3', state: 'CLOSED', stateReason: 'COMPLETED' },
        { url: 'https://github.com/acme/widget/issues/4', state: 'OPEN', stateReason: null },
      ],
      failed: ['https://example.com/acme/x/issues/1'],
      rateLimited: false,
    })
    const calls = (await readFile(log, 'utf8')).trim().split('\n')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('api graphql')
  })

  it('keeps the issues gh answered when one in the batch is gone', async () => {
    const read = await issueStates(['https://github.com/acme/widget/issues/3', 'https://github.com/acme/gone/issues/9'])
    expect(read.issues).toEqual([{ url: 'https://github.com/acme/widget/issues/3', state: 'CLOSED', stateReason: 'COMPLETED' }])
    expect(read.failed).toEqual(['https://github.com/acme/gone/issues/9'])
    expect(read.rateLimited).toBe(false)
  })

  it('records one gh issues span per batch with the batch size', async () => {
    delete process.env['FAKE_GH_MODE']
    using recorder = recordSpans()
    await Effect.runPromise(
      GitHubCli.use(github => github.issueStates({ urls: ['https://github.com/acme/widget/issues/3', 'https://github.com/acme/widget/issues/4'] })).pipe(
        Effect.provide(layer),
        Effect.provide(DshxEffect.tracerLayer),
      ),
    )
    expect(recorder.span('pull request gh issues').attributes).toMatchObject({ 'dshx.plugin.package': '@dshfiles/pull-requests', 'github.issues': 2 })
  })

  it('reports a rate limit and reads nothing more', async () => {
    process.env['FAKE_GH_MODE'] = 'limited'
    const urls = Array.from({ length: 60 }, (_, index) => `https://github.com/acme/widget/issues/${String(index + 1)}`)
    const before = (await readFile(log, 'utf8')).trim().split('\n').length
    const read = await issueStates(urls)
    expect(read).toEqual({ issues: [], failed: urls, rateLimited: true })
    expect((await readFile(log, 'utf8')).trim().split('\n').length - before).toBe(1)
  })
})
