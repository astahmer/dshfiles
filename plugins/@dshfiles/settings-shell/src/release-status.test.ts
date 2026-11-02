import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { TestClock } from 'effect/testing'
import { InstalledVersions } from './installed-versions.js'
import { ReleaseCheck } from './release-check.js'
import { githubReleasesJson, releaseStatusFromGitHub } from './release-status.js'

const githubRelease = (input: { readonly tag: string; readonly body?: string; readonly draft?: boolean }) => ({
  tag_name: input.tag,
  name: null,
  published_at: '2026-10-17T08:16:33Z',
  draft: input.draft ?? false,
  body: input.body ?? null,
  html_url: 'ignored external field',
})

describe('DSH GitHub release status', () => {
  it('lists releases after the installed version and keeps their links on GitHub', () => {
    const status = releaseStatusFromGitHub({
      currentVersion: '0.2.1-rc.1',
      releases: [githubRelease({ tag: 'dsh-v0.2.1-rc.2' }), githubRelease({ tag: 'dsh-v0.2.1-rc.1' })],
    })

    expect(status.available).toBe(true)
    expect(status.comparisonKnown).toBe(true)
    expect(status.releases.map(release => release.version)).toEqual(['0.2.1-rc.2'])
    expect(status.latestUrl).toBe('https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2')
  })

  it('does not claim an update when the installed tag is missing or current', () => {
    const releases = [githubRelease({ tag: 'dsh-v0.2.1-rc.2' }), githubRelease({ tag: 'dsh-v0.2.1-rc.1' })]
    expect(releaseStatusFromGitHub({ currentVersion: '0.2.1-rc.2', releases })).toMatchObject({ available: false, comparisonKnown: true })
    expect(releaseStatusFromGitHub({ currentVersion: '0.2.1-custom', releases })).toMatchObject({ available: false, comparisonKnown: false })
  })

  it('extracts bounded English release highlights without exposing HTML', () => {
    const status = releaseStatusFromGitHub({
      currentVersion: '0.2.1-rc.1',
      releases: [
        githubRelease({
          tag: 'dsh-v0.2.1-rc.2',
          body: '<h3 id="cn-release">新增功能</h3>\n- 忽略中文\n<h3 id="en-release">New Features</h3>\n- Add **plugin updates** with `hot reload`. by @contributor',
        }),
        githubRelease({ tag: 'dsh-v0.2.1-rc.1' }),
      ],
    })

    expect(status.releases[0]?.highlights).toEqual([{ section: 'New Features', text: 'Add plugin updates with hot reload.' }])
  })

  it('rejects malformed release payloads', () => {
    expect(Schema.decodeUnknownResult(githubReleasesJson)(JSON.stringify([{ tag_name: 'not valid' }]))._tag).toBe('Failure')
  })
})

/** GitHub is external to the plugin: each test answers the releases request with a fixed response. */
const answering = (respond: () => Response) => {
  const requests: Array<{ readonly url: string; readonly init: RequestInit }> = []
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: input instanceof Request ? input.url : String(input), init: init ?? {} })
    return respond()
  }
  return { requests, fetcher }
}

const releasesResponse = (tags: readonly string[]) => new Response(JSON.stringify(tags.map(tag => githubRelease({ tag }))), { status: 200 })

const releaseCheck = Effect.map(
  Layer.build(
    ReleaseCheck.layer.pipe(
      Layer.provide(Layer.succeed(InstalledVersions, InstalledVersions.of({ dsh: '0.2.1-rc.1', upstream: null, welcome: null }))),
      Layer.provide(FetchHttpClient.layer),
    ),
  ),
  Context.get(ReleaseCheck),
)

const checkWith = (fetcher: typeof fetch) => (check: ReleaseCheck['Service']) => Effect.provideService(check.status, FetchHttpClient.Fetch, fetcher)

describe('ReleaseCheck', () => {
  it.effect('uses a fixed GitHub endpoint, rejects redirects and caches a result for an hour', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const github = answering(() => releasesResponse(['dsh-v0.2.1-rc.2', 'dsh-v0.2.1-rc.1']))
        const run = checkWith(github.fetcher)(yield* releaseCheck)

        expect((yield* run).latestVersion).toBe('0.2.1-rc.2')
        expect(github.requests).toHaveLength(1)
        expect(github.requests[0]?.url).toBe('https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=100')
        expect(github.requests[0]?.init.redirect).toBe('error')
        expect(new Headers(github.requests[0]?.init.headers).get('accept')).toBe('application/vnd.github+json')

        yield* TestClock.adjust('59 minutes')
        yield* run
        expect(github.requests).toHaveLength(1)
        yield* TestClock.adjust('1 minute')
        yield* run
        expect(github.requests).toHaveLength(2)
      }),
    ),
  )

  it.effect('records a dsh release check span with whether an update exists', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const recorder = yield* Effect.acquireRelease(
          Effect.sync(() => recordSpans()),
          spans => Effect.sync(() => spans.stop()),
        )
        const github = answering(() => releasesResponse(['dsh-v0.2.1-rc.2', 'dsh-v0.2.1-rc.1']))
        yield* checkWith(github.fetcher)(yield* releaseCheck).pipe(Effect.provide(tracerLayer))
        expect(recorder.named('dsh release check')).toHaveLength(1)
        const span = recorder.span('dsh release check')
        expect(span.kind).toBe('client')
        expect(span.attributes).toEqual({
          'server.address': 'api.github.com',
          'dshx.settings-shell.available': true,
          'dshx.settings-shell.releases': 1,
        })
      }),
    ),
  )

  it.effect('refuses an error status, an oversized body and a malformed payload without caching the failure', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const check = yield* releaseCheck
        const failed = yield* Effect.flip(checkWith(answering(() => new Response('{}', { status: 503 })).fetcher)(check))
        expect(failed).toMatchObject({ _tag: 'ReleaseCheckFailed', reason: 'status', status: 503 })

        const oversized = yield* Effect.flip(checkWith(answering(() => new Response('x'.repeat(1_000_001), { status: 200 })).fetcher)(check))
        expect(oversized.reason).toBe('too-large')

        const malformed = yield* Effect.flip(checkWith(answering(() => new Response('[{"tag_name":"x"}]', { status: 200 })).fetcher)(check))
        expect(malformed.reason).toBe('malformed')
      }),
    ),
  )
})
